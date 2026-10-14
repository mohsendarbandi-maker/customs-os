ALTER TABLE public.customs_declaration_workflow
  ADD COLUMN IF NOT EXISTS procedure_state jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.customs_declaration_workflow.procedure_state IS
  'Procedure-specific state for customs regimes other than definitive import; changes are captured by the workflow audit trigger.';
