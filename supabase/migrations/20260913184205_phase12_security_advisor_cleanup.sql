-- Phase 12 security advisor cleanup
-- Fix mutable search_path warnings on trigger functions.
ALTER FUNCTION public.prevent_audit_tampering() SET search_path = public, pg_temp;
ALTER FUNCTION public.prevent_org_id_mutation() SET search_path = public, pg_temp;
ALTER FUNCTION public.prevent_organization_deletion() SET search_path = public, pg_temp;
ALTER FUNCTION public.prevent_profile_deletion() SET search_path = public, pg_temp;
ALTER FUNCTION public.trigger_set_updated_at() SET search_path = public, pg_temp;

-- case_operational_readiness must honor the querying user's RLS context.
DROP VIEW IF EXISTS public.case_operational_readiness;
CREATE VIEW public.case_operational_readiness
WITH (security_invoker = true)
AS
SELECT
  id AS case_id,
  organization_id,
  case_number,
  status,
  COALESCE((get_case_completion_readiness(id) ->> 'ready'::text)::boolean, false) AS ready_for_completion,
  get_case_completion_readiness(id) -> 'issues'::text AS blocking_issues
FROM public.cases c;

REVOKE ALL ON TABLE public.case_operational_readiness FROM anon;
GRANT SELECT ON TABLE public.case_operational_readiness TO authenticated;
