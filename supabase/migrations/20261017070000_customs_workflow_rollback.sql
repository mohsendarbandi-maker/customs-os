-- Reversible last-change rollback for customs declaration workflow.
-- Reuse existing snapshots; do not create a parallel history store.
ALTER TABLE public.customs_declaration_workflow_events
  DROP CONSTRAINT IF EXISTS customs_declaration_workflow_events_event_type_check;

ALTER TABLE public.customs_declaration_workflow_events
  ADD CONSTRAINT customs_declaration_workflow_events_event_type_check
  CHECK (event_type IN ('created', 'stage_changed', 'saved', 'rollback'));

CREATE OR REPLACE FUNCTION public.log_customs_declaration_workflow_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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

    IF current_setting('app.customs_workflow_rollback', true) = 'true' THEN
      v_event_type := 'rollback';
    END IF;
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

CREATE OR REPLACE FUNCTION public.rollback_customs_declaration_workflow(p_workflow_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_org_id uuid := public.user_org_id();
  v_role text := COALESCE(public.user_role()::text, '');
  v_workflow public.customs_declaration_workflow%ROWTYPE;
  v_event public.customs_declaration_workflow_events%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF v_org_id IS NULL OR v_role NOT IN ('owner', 'admin', 'broker', 'warehouse') THEN
    RAISE EXCEPTION 'مجوز بازگردانی گردش‌کار را ندارید';
  END IF;

  SELECT * INTO v_workflow
  FROM public.customs_declaration_workflow
  WHERE id = p_workflow_id AND organization_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'گردش‌کار پیدا نشد یا به سازمان شما تعلق ندارد';
  END IF;

  SELECT * INTO v_event
  FROM public.customs_declaration_workflow_events
  WHERE workflow_id = p_workflow_id AND organization_id = v_org_id
  ORDER BY created_at DESC, id DESC
  LIMIT 1
  FOR UPDATE;

  IF v_event.id IS NULL
     OR v_event.event_type IN ('created', 'rollback')
     OR v_event.previous_snapshot IS NULL THEN
    RAISE EXCEPTION 'بازگردانی در دسترس نیست؛ هیچ تغییر ذخیره‌شده‌ای برای بازگردانی وجود ندارد';
  END IF;

  PERFORM set_config('app.customs_workflow_rollback', 'true', true);

  UPDATE public.customs_declaration_workflow
  SET current_stage = COALESCE(v_event.previous_stage, current_stage),
      evaluation_state = COALESCE(v_event.previous_snapshot -> 'evaluation_state', evaluation_state),
      expertise_state = COALESCE(v_event.previous_snapshot -> 'expertise_state', expertise_state),
      cashier_state = COALESCE(v_event.previous_snapshot -> 'cashier_state', cashier_state),
      loading_permit_state = COALESCE(v_event.previous_snapshot -> 'loading_permit_state', loading_permit_state),
      exit_state = COALESCE(v_event.previous_snapshot -> 'exit_state', exit_state),
      port_charges_state = COALESCE(v_event.previous_snapshot -> 'port_charges_state', port_charges_state),
      procedure_state = COALESCE(v_event.previous_snapshot -> 'procedure_state', procedure_state),
      notes = CASE WHEN v_event.previous_snapshot ? 'notes' THEN v_event.previous_snapshot ->> 'notes' ELSE notes END,
      updated_by = v_user_id,
      updated_at = clock_timestamp()
  WHERE id = p_workflow_id AND organization_id = v_org_id;

  PERFORM set_config('app.customs_workflow_rollback', 'false', true);
EXCEPTION
  WHEN OTHERS THEN
    PERFORM set_config('app.customs_workflow_rollback', 'false', true);
    RAISE;
END;
$$;

REVOKE ALL ON FUNCTION public.rollback_customs_declaration_workflow(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rollback_customs_declaration_workflow(uuid) TO authenticated;

COMMENT ON FUNCTION public.rollback_customs_declaration_workflow(uuid)
  IS 'Restores the previous saved workflow snapshot for an authorized user in the same organization and records an immutable rollback event.';
