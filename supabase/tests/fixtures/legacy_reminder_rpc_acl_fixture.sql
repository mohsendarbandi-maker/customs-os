-- Isolated ACL fixture for legacy operational reminder overloads.
DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  END IF;
END
$roles$;

CREATE OR REPLACE FUNCTION public.create_operational_reminder(
  p_title text,
  p_description text,
  p_due_at timestamptz,
  p_priority text,
  p_case_id uuid,
  p_shipment_id uuid
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_catalog, pg_temp
AS $function$ SELECT true $function$;

CREATE OR REPLACE FUNCTION public.create_operational_reminder(
  p_title text,
  p_description text,
  p_due_at timestamptz,
  p_priority text,
  p_case_id uuid,
  p_shipment_id uuid,
  p_due_precision text
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_catalog, pg_temp
AS $function$ SELECT true $function$;

-- The current JSONB API is the only supported client-callable overload.
CREATE OR REPLACE FUNCTION public.create_operational_reminder(p_payload jsonb)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_catalog, pg_temp
AS $function$ SELECT jsonb_typeof(p_payload) = 'object' $function$;

GRANT EXECUTE ON FUNCTION public.create_operational_reminder(
  text, text, timestamptz, text, uuid, uuid
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_operational_reminder(
  text, text, timestamptz, text, uuid, uuid, text
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_operational_reminder(jsonb)
  TO authenticated;
