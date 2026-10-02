-- Customs OS — reminder trigger-function ACL hardening
-- Trigger-only SECURITY DEFINER functions must not be callable through the Data API.
revoke all on function public.validate_operational_reminder_links() from public, anon, authenticated;
grant execute on function public.validate_operational_reminder_links() to service_role;

revoke all on function public.sync_operational_reminder_deliveries() from public, anon, authenticated;
grant execute on function public.sync_operational_reminder_deliveries() to service_role;
