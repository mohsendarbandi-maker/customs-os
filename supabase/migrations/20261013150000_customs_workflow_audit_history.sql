CREATE TABLE IF NOT EXISTS public.customs_declaration_workflow_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  declaration_id uuid NOT NULL,
  workflow_id uuid NOT NULL REFERENCES public.customs_declaration_workflow(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN ('created','stage_changed','saved')),
  previous_stage text,
  current_stage text NOT NULL,
  changed_fields text[] NOT NULL DEFAULT '{}',
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customs_declaration_workflow_events_declaration_tenant_fk
    FOREIGN KEY (declaration_id, organization_id)
    REFERENCES public.customs_declarations(id, organization_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS customs_workflow_events_timeline_idx
  ON public.customs_declaration_workflow_events(organization_id, declaration_id, created_at DESC);

CREATE INDEX IF NOT EXISTS customs_workflow_events_workflow_idx
  ON public.customs_declaration_workflow_events(workflow_id, created_at DESC);

ALTER TABLE public.customs_declaration_workflow_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS customs_declaration_workflow_events_select
  ON public.customs_declaration_workflow_events;

CREATE POLICY customs_declaration_workflow_events_select
  ON public.customs_declaration_workflow_events
  FOR SELECT TO authenticated
  USING (
    organization_id = public.user_org_id()
    AND (
      public.user_role() = ANY (ARRAY[
        'owner'::public.user_role,
        'admin'::public.user_role,
        'broker'::public.user_role,
        'warehouse'::public.user_role,
        'accountant'::public.user_role
      ])
      OR (
        public.user_role() = 'client'::public.user_role
        AND EXISTS (
          SELECT 1
          FROM public.customs_declarations d
          WHERE d.id = customs_declaration_workflow_events.declaration_id
            AND d.organization_id = customs_declaration_workflow_events.organization_id
            AND (
              EXISTS (
                SELECT 1 FROM public.shipments s
                WHERE s.id = d.shipment_id
                  AND s.organization_id = d.organization_id
                  AND s.client_id = public.user_client_id()
              )
              OR EXISTS (
                SELECT 1 FROM public.cases c
                WHERE c.id = d.case_id
                  AND c.organization_id = d.organization_id
                  AND c.client_id = public.user_client_id()
              )
            )
        )
      )
    )
  );

GRANT SELECT ON public.customs_declaration_workflow_events TO authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.customs_declaration_workflow_events FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.log_customs_declaration_workflow_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_changed_fields text[];
  v_event_type text;
  v_previous_stage text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_event_type := 'created';
    v_previous_stage := NULL;
    v_changed_fields := ARRAY[
      'current_stage','evaluation_state','expertise_state','cashier_state',
      'loading_permit_state','exit_state','port_charges_state'
    ];
  ELSE
    SELECT array_agg(entry.key ORDER BY entry.key)
      INTO v_changed_fields
    FROM jsonb_each(to_jsonb(NEW)) AS entry(key, value)
    WHERE entry.key NOT IN ('updated_at','updated_by')
      AND (to_jsonb(OLD) -> entry.key) IS DISTINCT FROM entry.value;

    IF COALESCE(array_length(v_changed_fields, 1), 0) = 0 THEN
      RETURN NEW;
    END IF;

    v_previous_stage := OLD.current_stage;
    v_event_type := CASE
      WHEN OLD.current_stage IS DISTINCT FROM NEW.current_stage THEN 'stage_changed'
      ELSE 'saved'
    END;
  END IF;

  INSERT INTO public.customs_declaration_workflow_events (
    organization_id, declaration_id, workflow_id, event_type,
    previous_stage, current_stage, changed_fields, snapshot, actor_id
  ) VALUES (
    NEW.organization_id,
    NEW.declaration_id,
    NEW.id,
    v_event_type,
    v_previous_stage,
    NEW.current_stage,
    COALESCE(v_changed_fields, '{}'),
    jsonb_build_object(
      'evaluation_state', NEW.evaluation_state,
      'expertise_state', NEW.expertise_state,
      'cashier_state', NEW.cashier_state,
      'loading_permit_state', NEW.loading_permit_state,
      'exit_state', NEW.exit_state,
      'port_charges_state', NEW.port_charges_state,
      'notes', NEW.notes
    ),
    COALESCE(NEW.updated_by, NEW.created_by, auth.uid())
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_customs_declaration_workflow_event
  ON public.customs_declaration_workflow;

CREATE TRIGGER trg_log_customs_declaration_workflow_event
  AFTER INSERT OR UPDATE ON public.customs_declaration_workflow
  FOR EACH ROW
  EXECUTE FUNCTION public.log_customs_declaration_workflow_event();

REVOKE ALL ON FUNCTION public.log_customs_declaration_workflow_event() FROM PUBLIC, anon, authenticated;
