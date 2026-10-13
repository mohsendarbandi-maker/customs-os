alter table public.customs_declaration_workflow
  add column if not exists procedure_state jsonb not null default '{}'::jsonb;

comment on column public.customs_declaration_workflow.procedure_state is
  'Procedure-specific state for customs regimes other than definitive import; changes are captured by the workflow audit trigger.';
