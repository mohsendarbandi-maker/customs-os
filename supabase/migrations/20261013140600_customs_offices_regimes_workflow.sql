-- Customs offices, regimes and declaration operational workflow.
ALTER TABLE public.customs_offices
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;

ALTER TABLE public.shipments
  ADD COLUMN IF NOT EXISTS customs_office_id uuid REFERENCES public.customs_offices(id) ON DELETE SET NULL;

ALTER TABLE public.shipment_customs_data
  ADD COLUMN IF NOT EXISTS customs_office_id uuid REFERENCES public.customs_offices(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS customs_regime text;

ALTER TABLE public.customs_declarations
  ADD COLUMN IF NOT EXISTS customs_regime text;

ALTER TABLE public.cases
  ADD COLUMN IF NOT EXISTS customs_regime text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='shipment_customs_data_customs_regime_check') THEN
    ALTER TABLE public.shipment_customs_data ADD CONSTRAINT shipment_customs_data_customs_regime_check
      CHECK (customs_regime IS NULL OR customs_regime IN (
        'import_definitive','export_definitive','import_temporary','temporary_processing',
        'external_transit','internal_transit','re_export','re_import','cabotage',
        'customs_warehouse','free_zone','other'
      ));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='customs_declarations_customs_regime_check') THEN
    ALTER TABLE public.customs_declarations ADD CONSTRAINT customs_declarations_customs_regime_check
      CHECK (customs_regime IS NULL OR customs_regime IN (
        'import_definitive','export_definitive','import_temporary','temporary_processing',
        'external_transit','internal_transit','re_export','re_import','cabotage',
        'customs_warehouse','free_zone','other'
      ));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='cases_customs_regime_check') THEN
    ALTER TABLE public.cases ADD CONSTRAINT cases_customs_regime_check
      CHECK (customs_regime IS NULL OR customs_regime IN (
        'import_definitive','export_definitive','import_temporary','temporary_processing',
        'external_transit','internal_transit','re_export','re_import','cabotage',
        'customs_warehouse','free_zone','other'
      ));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS shipments_customs_office_id_idx ON public.shipments(customs_office_id);
CREATE INDEX IF NOT EXISTS customs_declarations_office_regime_idx ON public.customs_declarations(customs_office_id, customs_regime);

ALTER TABLE public.customs_offices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS customs_offices_select ON public.customs_offices;
DROP POLICY IF EXISTS customs_offices_insert ON public.customs_offices;
DROP POLICY IF EXISTS customs_offices_update ON public.customs_offices;
DROP POLICY IF EXISTS customs_offices_delete ON public.customs_offices;

CREATE POLICY customs_offices_select ON public.customs_offices
  FOR SELECT TO authenticated
  USING (organization_id IS NULL OR organization_id = public.user_org_id());

CREATE POLICY customs_offices_insert ON public.customs_offices
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = public.user_org_id()
    AND public.user_role() = ANY (ARRAY['owner'::public.user_role, 'admin'::public.user_role])
  );

CREATE POLICY customs_offices_update ON public.customs_offices
  FOR UPDATE TO authenticated
  USING (
    organization_id = public.user_org_id()
    AND public.user_role() = ANY (ARRAY['owner'::public.user_role, 'admin'::public.user_role])
  )
  WITH CHECK (
    organization_id = public.user_org_id()
    AND public.user_role() = ANY (ARRAY['owner'::public.user_role, 'admin'::public.user_role])
  );

CREATE POLICY customs_offices_delete ON public.customs_offices
  FOR DELETE TO authenticated
  USING (
    organization_id = public.user_org_id()
    AND public.user_role() = ANY (ARRAY['owner'::public.user_role, 'admin'::public.user_role])
  );

CREATE OR REPLACE FUNCTION public.validate_customs_office_tenant()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  office_org uuid;
BEGIN
  IF NEW.customs_office_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT organization_id INTO office_org
  FROM public.customs_offices
  WHERE id = NEW.customs_office_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'customs_office_not_found';
  END IF;
  IF office_org IS NOT NULL AND office_org IS DISTINCT FROM NEW.organization_id THEN
    RAISE EXCEPTION 'customs_office_organization_mismatch';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_customs_office_tenant_shipments ON public.shipments;
CREATE TRIGGER trg_validate_customs_office_tenant_shipments
  BEFORE INSERT OR UPDATE OF customs_office_id, organization_id ON public.shipments
  FOR EACH ROW EXECUTE FUNCTION public.validate_customs_office_tenant();

DROP TRIGGER IF EXISTS trg_validate_customs_office_tenant_cases ON public.cases;
CREATE TRIGGER trg_validate_customs_office_tenant_cases
  BEFORE INSERT OR UPDATE OF customs_office_id, organization_id ON public.cases
  FOR EACH ROW EXECUTE FUNCTION public.validate_customs_office_tenant();

DROP TRIGGER IF EXISTS trg_validate_customs_office_tenant_declarations ON public.customs_declarations;
CREATE TRIGGER trg_validate_customs_office_tenant_declarations
  BEFORE INSERT OR UPDATE OF customs_office_id, organization_id ON public.customs_declarations
  FOR EACH ROW EXECUTE FUNCTION public.validate_customs_office_tenant();

DROP TRIGGER IF EXISTS trg_validate_customs_office_tenant_shipment_data ON public.shipment_customs_data;
CREATE TRIGGER trg_validate_customs_office_tenant_shipment_data
  BEFORE INSERT OR UPDATE OF customs_office_id, organization_id ON public.shipment_customs_data
  FOR EACH ROW EXECUTE FUNCTION public.validate_customs_office_tenant();

CREATE TABLE IF NOT EXISTS public.customs_declaration_workflow (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  declaration_id uuid NOT NULL UNIQUE,
  current_stage text NOT NULL DEFAULT 'evaluation'
    CHECK (current_stage IN ('evaluation','expertise','cashier','loading_permit','exit','port_charges','abandoned','completed')),
  evaluation_state jsonb NOT NULL DEFAULT '{"status":"not_required","evaluator_number":"","expert_requested":false,"expert_request_note":""}'::jsonb,
  expertise_state jsonb NOT NULL DEFAULT '{"appointment_status":"not_requested","appointment_number":"","road_authority_status":"not_required","plant_quarantine_status":"not_required","standard":{"expert_review":"pending","inspection_status":"not_requested","inspection_company":"","inspection_fee":null,"inspection_paid":false,"inspection_invoice_received":false,"sample_status":"not_sent","laboratory":"","results_uploaded":false,"standard_fee":null,"standard_fee_paid":false,"standard_notified":false}}'::jsonb,
  cashier_state jsonb NOT NULL DEFAULT '{"method":"pending","cash_paid_irr":null,"guarantee_duties":false,"guarantee_vat":false,"guarantee_reference":""}'::jsonb,
  loading_permit_state jsonb NOT NULL DEFAULT '{"clause2_request_status":"not_required","tax_permission_status":"pending","central_bank_status":"pending","sata_code":"","clearance_90_percent_requested":false,"comment":""}'::jsonb,
  exit_state jsonb NOT NULL DEFAULT '{"loading_permission_status":"pending","financial_registration_status":"pending","weighbridge_required":false,"weighbridge_demand_irr":null,"weighbridge_paid":false,"loading_completed_at":null}'::jsonb,
  port_charges_state jsonb NOT NULL DEFAULT '{"insurance_policy_no":"","insurance_issue_date":null,"warehouse_receipt_date":null,"initial_invoice_status":"pending","transport_power_of_attorney_status":"pending","loading_form_received_at":null,"loading_started_at":null,"supplemental_invoice_status":"not_required","last_truck_loaded_at":null}'::jsonb,
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customs_declaration_workflow_declaration_tenant_fk
    FOREIGN KEY (declaration_id, organization_id)
    REFERENCES public.customs_declarations(id, organization_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS customs_declaration_workflow_org_stage_idx
  ON public.customs_declaration_workflow(organization_id, current_stage);

ALTER TABLE public.customs_declaration_workflow ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS customs_declaration_workflow_select ON public.customs_declaration_workflow;
DROP POLICY IF EXISTS customs_declaration_workflow_insert ON public.customs_declaration_workflow;
DROP POLICY IF EXISTS customs_declaration_workflow_update ON public.customs_declaration_workflow;
DROP POLICY IF EXISTS customs_declaration_workflow_delete ON public.customs_declaration_workflow;

CREATE POLICY customs_declaration_workflow_select ON public.customs_declaration_workflow
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
          WHERE d.id = customs_declaration_workflow.declaration_id
            AND d.organization_id = customs_declaration_workflow.organization_id
            AND (
              EXISTS (
                SELECT 1
                FROM public.shipments s
                WHERE s.id = d.shipment_id
                  AND s.organization_id = d.organization_id
                  AND s.client_id = public.user_client_id()
              )
              OR EXISTS (
                SELECT 1
                FROM public.cases c
                WHERE c.id = d.case_id
                  AND c.organization_id = d.organization_id
                  AND c.client_id = public.user_client_id()
              )
            )
        )
      )
    )
  );

CREATE POLICY customs_declaration_workflow_insert ON public.customs_declaration_workflow
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = public.user_org_id()
    AND public.user_role() = ANY (ARRAY['owner'::public.user_role,'admin'::public.user_role,'broker'::public.user_role,'warehouse'::public.user_role])
  );

CREATE POLICY customs_declaration_workflow_update ON public.customs_declaration_workflow
  FOR UPDATE TO authenticated
  USING (
    organization_id = public.user_org_id()
    AND public.user_role() = ANY (ARRAY['owner'::public.user_role,'admin'::public.user_role,'broker'::public.user_role,'warehouse'::public.user_role])
  )
  WITH CHECK (
    organization_id = public.user_org_id()
    AND public.user_role() = ANY (ARRAY['owner'::public.user_role,'admin'::public.user_role,'broker'::public.user_role,'warehouse'::public.user_role])
  );

CREATE POLICY customs_declaration_workflow_delete ON public.customs_declaration_workflow
  FOR DELETE TO authenticated
  USING (
    organization_id = public.user_org_id()
    AND public.user_role() = ANY (ARRAY['owner'::public.user_role,'admin'::public.user_role])
  );

REVOKE ALL ON FUNCTION public.validate_customs_office_tenant() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.validate_customs_office_tenant() TO authenticated;
