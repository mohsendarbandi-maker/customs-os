ALTER TABLE public.customs_declaration_workflow
  DROP CONSTRAINT IF EXISTS customs_declaration_workflow_current_stage_check;

ALTER TABLE public.customs_declaration_workflow
  ADD CONSTRAINT customs_declaration_workflow_current_stage_check
  CHECK (current_stage = ANY (ARRAY[
    'evaluation','expertise','cashier','loading_permit','exit','port_charges','abandoned','completed',
    'documents','permits','declaration','valuation','loading'
  ]::text[]));
