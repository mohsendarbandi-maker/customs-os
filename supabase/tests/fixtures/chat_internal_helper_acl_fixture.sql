-- Isolated fixture for direct RPC ACL hardening of private chat helpers.
-- It runs in its own PostgreSQL database so role grants cannot leak into other tests.
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

CREATE OR REPLACE FUNCTION public.orgs_are_connected(p_left uuid, p_right uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog, pg_temp
AS $function$
  SELECT p_left IS NOT NULL AND p_right IS NOT NULL AND p_left <> p_right;
$function$;

CREATE OR REPLACE FUNCTION public.chat_connection_allowed_for_conversation(
  p_conversation_id uuid,
  p_organization_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog, pg_temp
AS $function$
  SELECT p_conversation_id IS NOT NULL AND p_organization_id IS NOT NULL;
$function$;

-- These model the two trusted SECURITY DEFINER call paths found in Production:
-- chat_add_member() and chat_storage_path_allowed().
CREATE OR REPLACE FUNCTION public.chat_add_member_acl_probe(
  p_source_organization_id uuid,
  p_target_organization_id uuid
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_catalog, pg_temp
AS $function$
  SELECT public.orgs_are_connected(p_source_organization_id, p_target_organization_id);
$function$;

CREATE OR REPLACE FUNCTION public.chat_storage_path_acl_probe(
  p_source_organization_id uuid,
  p_current_organization_id uuid
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_catalog, pg_temp
AS $function$
  SELECT public.orgs_are_connected(p_source_organization_id, p_current_organization_id);
$function$;

GRANT EXECUTE ON FUNCTION public.chat_add_member_acl_probe(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.chat_storage_path_acl_probe(uuid, uuid) TO authenticated;


CREATE TABLE public.trigger_acl_probe (
  id integer primary key,
  trigger_ran boolean not null default false
);

CREATE OR REPLACE FUNCTION public.chat_trigger_acl_probe()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, pg_temp
AS $function$
BEGIN
  NEW.trigger_ran := true;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER chat_trigger_acl_probe_before_insert
BEFORE INSERT ON public.trigger_acl_probe
FOR EACH ROW EXECUTE FUNCTION public.chat_trigger_acl_probe();

GRANT INSERT, SELECT ON public.trigger_acl_probe TO authenticated;
