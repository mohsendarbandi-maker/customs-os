-- Index the foreign-key columns introduced or exposed by the customs workflow migration.
CREATE INDEX IF NOT EXISTS customs_offices_organization_id_idx
  ON public.customs_offices(organization_id);

CREATE INDEX IF NOT EXISTS shipment_customs_data_customs_office_id_idx
  ON public.shipment_customs_data(customs_office_id);

CREATE INDEX IF NOT EXISTS customs_declaration_workflow_created_by_idx
  ON public.customs_declaration_workflow(created_by);

CREATE INDEX IF NOT EXISTS customs_declaration_workflow_updated_by_idx
  ON public.customs_declaration_workflow(updated_by);

CREATE INDEX IF NOT EXISTS customs_declaration_workflow_declaration_org_idx
  ON public.customs_declaration_workflow(declaration_id, organization_id);
