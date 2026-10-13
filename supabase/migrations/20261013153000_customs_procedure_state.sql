alter table public.customs_declaration_workflow
  add column if not exists procedure_state jsonb not null default '{}'::jsonb;

comment on column public.customs_declaration_workflow.procedure_state is
  'Procedure-specific state for customs regimes other than definitive import; changes are captured by the workflow audit trigger.';

alter table public.customs_declaration_workflow
  drop constraint if exists customs_declaration_workflow_current_stage_check;

alter table public.customs_declaration_workflow
  add constraint customs_declaration_workflow_current_stage_check
  check (current_stage = any (array[
    'evaluation','expertise','cashier','loading_permit','exit','port_charges','abandoned','completed',
    'documents','permits','declaration','valuation','loading'
  ]::text[]));
