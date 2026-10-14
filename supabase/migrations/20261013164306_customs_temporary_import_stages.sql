alter table public.customs_declaration_workflow
  drop constraint if exists customs_declaration_workflow_current_stage_check;

alter table public.customs_declaration_workflow
  add constraint customs_declaration_workflow_current_stage_check
  check (current_stage = any (array[
    'evaluation','expertise','cashier','loading_permit','exit','port_charges','abandoned','completed',
    'documents','permits','declaration','valuation','loading','guarantee','use_period','re_export'
  ]::text[]));
