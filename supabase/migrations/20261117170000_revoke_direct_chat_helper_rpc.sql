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

-- Trigger functions cannot be called as normal RPCs. PostgreSQL checks EXECUTE
-- when a trigger is created, not each time the trigger fires, so removing the
-- API-role grant does not prevent trusted triggers from running.
DO $trigger_acl$
DECLARE
  v_function record;
BEGIN
  FOR v_function IN
    SELECT n.nspname, p.proname
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
      AND p.prorettype = 'trigger'::regtype
  LOOP
    EXECUTE pg_catalog.format(
      'REVOKE EXECUTE ON FUNCTION %I.%I() FROM PUBLIC, anon, authenticated',
      v_function.nspname,
      v_function.proname
    );
  END LOOP;
END
$trigger_acl$;

COMMIT;
