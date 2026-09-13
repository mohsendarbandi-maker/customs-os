-- Phase 25: trigger-only SECURITY DEFINER function must not be directly executable by application roles.
REVOKE ALL ON FUNCTION public.registration_order_set_tenant_and_case_client() FROM PUBLIC, anon, authenticated;
