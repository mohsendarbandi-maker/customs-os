-- The application now uses create_operational_reminder(jsonb), which enforces
-- the internal-role allowlist, tenant scope, assignee scope and linked-entity
-- visibility. The two legacy positional overloads have no remaining callsite
-- in the application and omit the client-role guard, so they must not remain
-- callable as direct SECURITY DEFINER Data API RPCs.
BEGIN;

REVOKE EXECUTE ON FUNCTION public.create_operational_reminder(
  text, text, timestamptz, text, uuid, uuid
) FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.create_operational_reminder(
  text, text, timestamptz, text, uuid, uuid, text
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_operational_reminder(
  text, text, timestamptz, text, uuid, uuid
) TO service_role;

GRANT EXECUTE ON FUNCTION public.create_operational_reminder(
  text, text, timestamptz, text, uuid, uuid, text
) TO service_role;

COMMIT;
