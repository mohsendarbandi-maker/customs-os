-- The current UI computes case alerts read-only and no trusted database
-- routine/trigger calls this synchronizer. It must not be exposed as a direct
-- authenticated RPC: SECURITY DEFINER would bypass reminder RLS and allow a
-- client user to rebuild/close system reminders across the organization.
-- Keep only the trusted service-role path for controlled backend maintenance.
BEGIN;

REVOKE EXECUTE ON FUNCTION public.sync_case_alert_reminders(uuid)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.sync_case_alert_reminders(uuid)
  TO service_role;

COMMIT;
