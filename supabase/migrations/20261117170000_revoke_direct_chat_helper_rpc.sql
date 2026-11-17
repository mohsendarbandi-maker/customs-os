-- These routines are implementation helpers, not public RPC endpoints.
-- Keep their use from trusted SECURITY DEFINER parents and trusted backend calls,
-- while denying direct Data API execution by authenticated/anonymous API roles.
BEGIN;

REVOKE EXECUTE ON FUNCTION public.orgs_are_connected(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.chat_connection_allowed_for_conversation(uuid, uuid)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.orgs_are_connected(uuid, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.chat_connection_allowed_for_conversation(uuid, uuid)
  TO service_role;

COMMIT;
