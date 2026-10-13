-- Preserve before/after state for every customs procedure, including export,
-- temporary admission, transit and other regimes stored in procedure_state.
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
  v_previous_snapshot jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_event_type := 'created';
    v_previous_stage := NULL;
    v_previous_snapshot := NULL;
    v_changed_fields := ARRAY[
      'current_stage','evaluation_state','expertise_state','cashier_state',
      'loading_permit_state','exit_state','port_charges_state','procedure_state'
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
    v_previous_snapshot := jsonb_build_object(
      'evaluation_state', OLD.evaluation_state,
      'expertise_state', OLD.expertise_state,
      'cashier_state', OLD.cashier_state,
      'loading_permit_state', OLD.loading_permit_state,
      'exit_state', OLD.exit_state,
      'port_charges_state', OLD.port_charges_state,
      'procedure_state', OLD.procedure_state,
      'notes', OLD.notes
    );
    v_event_type := CASE
      WHEN OLD.current_stage IS DISTINCT FROM NEW.current_stage THEN 'stage_changed'
      ELSE 'saved'
    END;
  END IF;

  INSERT INTO public.customs_declaration_workflow_events (
    organization_id, declaration_id, workflow_id, event_type,
    previous_stage, current_stage, changed_fields, previous_snapshot, snapshot, actor_id
  ) VALUES (
    NEW.organization_id,
    NEW.declaration_id,
    NEW.id,
    v_event_type,
    v_previous_stage,
    NEW.current_stage,
    COALESCE(v_changed_fields, '{}'),
    v_previous_snapshot,
    jsonb_build_object(
      'evaluation_state', NEW.evaluation_state,
      'expertise_state', NEW.expertise_state,
      'cashier_state', NEW.cashier_state,
      'loading_permit_state', NEW.loading_permit_state,
      'exit_state', NEW.exit_state,
      'port_charges_state', NEW.port_charges_state,
      'procedure_state', NEW.procedure_state,
      'notes', NEW.notes
    ),
    COALESCE(NEW.updated_by, NEW.created_by, auth.uid())
  );

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.log_customs_declaration_workflow_event() FROM PUBLIC, anon, authenticated;
