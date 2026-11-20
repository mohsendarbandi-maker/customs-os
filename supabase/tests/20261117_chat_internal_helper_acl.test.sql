DO $test$
DECLARE
  v_source constant uuid := '10000000-0000-0000-0000-000000000001';
  v_target constant uuid := '10000000-0000-0000-0000-000000000002';
BEGIN
  IF has_function_privilege('authenticated', 'public.orgs_are_connected(uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated can still invoke orgs_are_connected directly';
  END IF;
  IF has_function_privilege('anon', 'public.orgs_are_connected(uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon can invoke orgs_are_connected';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.orgs_are_connected(uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role lost trusted orgs_are_connected access';
  END IF;
  IF NOT has_function_privilege('postgres', 'public.orgs_are_connected(uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'function owner lost orgs_are_connected access';
  END IF;
  IF has_function_privilege('authenticated', 'public.chat_trigger_acl_probe()', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated can directly execute trigger function';
  END IF;

  IF has_function_privilege('authenticated', 'public.chat_connection_allowed_for_conversation(uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated can still invoke chat_connection_allowed_for_conversation directly';
  END IF;
  IF has_function_privilege('anon', 'public.chat_connection_allowed_for_conversation(uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon can invoke chat_connection_allowed_for_conversation';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.chat_connection_allowed_for_conversation(uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role lost trusted chat_connection_allowed_for_conversation access';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.chat_add_member_acl_probe(uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated cannot invoke expected parent helper';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.chat_storage_path_acl_probe(uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated cannot invoke expected storage parent helper';
  END IF;
END
$test$;

SET ROLE authenticated;

DO $direct_denial$
BEGIN
  BEGIN
    PERFORM public.orgs_are_connected(
      '10000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000002'
    );
    RAISE EXCEPTION 'direct orgs_are_connected RPC unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  BEGIN
    PERFORM public.chat_connection_allowed_for_conversation(
      '20000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000002'
    );
    RAISE EXCEPTION 'direct chat_connection_allowed_for_conversation RPC unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END
$direct_denial$;

INSERT INTO public.trigger_acl_probe(id) VALUES (1);

DO $nested_access$
DECLARE
  v_source constant uuid := '10000000-0000-0000-0000-000000000001';
  v_target constant uuid := '10000000-0000-0000-0000-000000000002';
BEGIN
  IF public.chat_add_member_acl_probe(v_source, v_target) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'trusted chat_add_member-style SECURITY DEFINER call path broke';
  END IF;
  IF public.chat_storage_path_acl_probe(v_source, v_target) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'trusted chat_storage_path_allowed-style SECURITY DEFINER call path broke';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.trigger_acl_probe WHERE id = 1 AND trigger_ran = true) THEN
    RAISE EXCEPTION 'trigger stopped running after direct RPC privilege was revoked';
  END IF;
END
$nested_access$;

RESET ROLE;
