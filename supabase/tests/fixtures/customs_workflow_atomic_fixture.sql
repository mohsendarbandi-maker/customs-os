-- Minimal PostgreSQL contract fixture for the customs workflow migration.
-- This is test-only and must never be pointed at the live Supabase project.

CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE SCHEMA auth;

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

CREATE OR REPLACE FUNCTION public.user_org_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.org_id', true), '')::uuid;
$$;

CREATE OR REPLACE FUNCTION public.user_role()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.role', true), '');
$$;

CREATE TABLE public.shipments (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  finance_status text NOT NULL DEFAULT 'not_ready',
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.customs_declarations (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  shipment_id uuid NOT NULL REFERENCES public.shipments(id),
  customs_regime text,
  customs_path text,
  workflow_stage integer NOT NULL DEFAULT 4,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.customs_declaration_workflow (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  declaration_id uuid NOT NULL,
  current_stage text NOT NULL DEFAULT 'evaluation',
  evaluation_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  expertise_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  cashier_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  loading_permit_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  exit_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  port_charges_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  procedure_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (organization_id, declaration_id)
);

CREATE TABLE public.customs_declaration_workflow_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  declaration_id uuid NOT NULL,
  workflow_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('created','stage_changed','saved','rollback')),
  previous_stage text,
  current_stage text NOT NULL,
  changed_fields text[] NOT NULL DEFAULT '{}'::text[],
  previous_snapshot jsonb,
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE OR REPLACE FUNCTION public.log_customs_declaration_workflow_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
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
$function$;

CREATE TRIGGER trg_log_customs_declaration_workflow_event
AFTER INSERT OR UPDATE ON public.customs_declaration_workflow
FOR EACH ROW EXECUTE FUNCTION public.log_customs_declaration_workflow_event();

CREATE TABLE public.declaration_exit_checklist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  declaration_id uuid NOT NULL,
  item_key text NOT NULL,
  completed boolean NOT NULL DEFAULT false,
  UNIQUE (organization_id, declaration_id, item_key)
);

CREATE TABLE public.shipment_customs_data (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  shipment_id uuid NOT NULL UNIQUE REFERENCES public.shipments(id),
  sata_code text
);

CREATE OR REPLACE FUNCTION public.guard_finance_role_updates()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF public.user_role() = 'warehouse' THEN
    IF NEW.finance_status <> 'ready'
       OR OLD.finance_status <> 'not_ready'
       OR (to_jsonb(NEW) - ARRAY['finance_status','updated_at'])
          IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['finance_status','updated_at'])
    THEN
      RAISE EXCEPTION 'Warehouse may only move a shipment to finance-ready';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_guard_finance_role_shipments
BEFORE UPDATE ON public.shipments
FOR EACH ROW EXECUTE FUNCTION public.guard_finance_role_updates();

ALTER TABLE public.customs_declaration_workflow ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customs_declaration_workflow_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customs_declarations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shipments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.declaration_exit_checklist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shipment_customs_data ENABLE ROW LEVEL SECURITY;

CREATE POLICY workflow_select ON public.customs_declaration_workflow
  FOR SELECT TO authenticated
  USING (organization_id = public.user_org_id()
    AND public.user_role() IN ('owner','admin','broker','warehouse','accountant'));
CREATE POLICY workflow_update ON public.customs_declaration_workflow
  FOR UPDATE TO authenticated
  USING (organization_id = public.user_org_id()
    AND public.user_role() IN ('owner','admin','broker','warehouse'))
  WITH CHECK (organization_id = public.user_org_id()
    AND public.user_role() IN ('owner','admin','broker','warehouse'));

CREATE POLICY workflow_event_select ON public.customs_declaration_workflow_events
  FOR SELECT TO authenticated
  USING (organization_id = public.user_org_id()
    AND public.user_role() IN ('owner','admin','broker','warehouse','accountant'));

CREATE POLICY declaration_select ON public.customs_declarations
  FOR SELECT TO authenticated
  USING (organization_id = public.user_org_id()
    AND public.user_role() IN ('owner','admin','broker','warehouse'));
CREATE POLICY declaration_update ON public.customs_declarations
  FOR UPDATE TO authenticated
  USING (organization_id = public.user_org_id()
    AND public.user_role() IN ('owner','admin','broker','warehouse'))
  WITH CHECK (organization_id = public.user_org_id()
    AND public.user_role() IN ('owner','admin','broker','warehouse'));

CREATE POLICY shipment_select ON public.shipments
  FOR SELECT TO authenticated
  USING (organization_id = public.user_org_id()
    AND public.user_role() IN ('owner','admin','broker','warehouse'));
CREATE POLICY shipment_update ON public.shipments
  FOR UPDATE TO authenticated
  USING (organization_id = public.user_org_id()
    AND public.user_role() IN ('owner','admin','broker','warehouse'))
  WITH CHECK (organization_id = public.user_org_id()
    AND public.user_role() IN ('owner','admin','broker','warehouse'));

CREATE POLICY exit_checklist_select ON public.declaration_exit_checklist_items
  FOR SELECT TO authenticated
  USING (organization_id = public.user_org_id()
    AND public.user_role() IN ('owner','admin','broker','warehouse'));
CREATE POLICY exit_checklist_update ON public.declaration_exit_checklist_items
  FOR UPDATE TO authenticated
  USING (organization_id = public.user_org_id()
    AND public.user_role() IN ('owner','admin','broker','warehouse'))
  WITH CHECK (organization_id = public.user_org_id()
    AND public.user_role() IN ('owner','admin','broker','warehouse'));

CREATE POLICY shipment_customs_data_select ON public.shipment_customs_data
  FOR SELECT TO authenticated
  USING (organization_id = public.user_org_id()
    AND public.user_role() IN ('owner','admin','broker','warehouse'));
CREATE POLICY shipment_customs_data_insert ON public.shipment_customs_data
  FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.user_org_id()
    AND public.user_role() IN ('owner','admin','broker','warehouse'));
CREATE POLICY shipment_customs_data_update ON public.shipment_customs_data
  FOR UPDATE TO authenticated
  USING (organization_id = public.user_org_id()
    AND public.user_role() IN ('owner','admin','broker','warehouse'))
  WITH CHECK (organization_id = public.user_org_id()
    AND public.user_role() IN ('owner','admin','broker','warehouse'));

GRANT USAGE ON SCHEMA public, auth TO authenticated;
GRANT SELECT, UPDATE ON public.customs_declaration_workflow TO authenticated;
GRANT SELECT ON public.customs_declaration_workflow_events TO authenticated;
GRANT SELECT, UPDATE ON public.customs_declarations TO authenticated;
GRANT SELECT, UPDATE ON public.shipments TO authenticated;
GRANT SELECT, UPDATE ON public.declaration_exit_checklist_items TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.shipment_customs_data TO authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_org_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_role() TO authenticated;

-- Seed rows are inserted by the database owner to keep test setup separate from RLS.
INSERT INTO public.shipments (id, organization_id, finance_status)
VALUES (
  '00000000-0000-0000-0000-000000000010',
  '00000000-0000-0000-0000-000000000001',
  'not_ready'
);

INSERT INTO public.customs_declarations (
  id, organization_id, shipment_id, customs_regime, customs_path, workflow_stage
) VALUES (
  '00000000-0000-0000-0000-000000000020',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000010',
  'import_definitive',
  'green',
  4
);

INSERT INTO public.customs_declaration_workflow (
  id, organization_id, declaration_id, current_stage,
  evaluation_state, expertise_state, cashier_state,
  loading_permit_state, exit_state, port_charges_state
) VALUES (
  '00000000-0000-0000-0000-000000000030',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000020',
  'evaluation',
  '{"status":"not_required","expert_requested":false,"evaluator_number":"","expert_request_note":""}',
  '{"appointment_status":"not_requested","appointment_number":"","road_authority_status":"not_required","plant_quarantine_status":"not_required","standard":{"expert_review":"pending","inspection_status":"not_requested","inspection_fee":null,"inspection_paid":false,"inspection_invoice_status":"pending","sample_status":"not_sent","results_uploaded":false,"standard_fee":null,"standard_fee_paid":false,"standard_notified":false}}',
  '{"method":"pending","cash_paid_irr":null,"guarantee_duties":false,"guarantee_vat":false,"guarantee_reference":""}',
  '{"clause2_request_status":"pending","tax_permission_status":"pending","central_bank_status":"pending","sata_code":"","clearance_90_percent_requested":false,"comment":""}',
  '{"loading_permission_status":"pending","financial_registration_status":"pending","weighbridge_required":false,"weighbridge_paid":false,"loading_completed_at":""}',
  '{"insurance_policy_no":"","insurance_issue_date":"","insurance_followup_status":"pending","warehouse_receipt_date":"","initial_invoice_status":"pending","transport_power_of_attorney_status":"pending","loading_form_received_at":"","loading_started_at":"","supplemental_invoice_status":"not_required","last_truck_loaded_at":""}'
);

INSERT INTO public.declaration_exit_checklist_items (
  organization_id, declaration_id, item_key, completed
) VALUES
  ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000020','warehouse_invoice_initial',false),
  ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000020','warehouse_invoice_supplement',false),
  ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000020','transport_power_of_attorney',false);
