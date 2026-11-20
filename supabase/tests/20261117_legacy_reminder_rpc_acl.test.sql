DO $test$
BEGIN
  IF has_function_privilege('authenticated',
    'public.create_operational_reminder(text,text,timestamptz,text,uuid,uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'authenticated can still invoke six-argument legacy reminder overload';
  END IF;
  IF has_function_privilege('authenticated',
    'public.create_operational_reminder(text,text,timestamptz,text,uuid,uuid,text)','EXECUTE') THEN
    RAISE EXCEPTION 'authenticated can still invoke seven-argument legacy reminder overload';
  END IF;
  IF has_function_privilege('anon',
    'public.create_operational_reminder(text,text,timestamptz,text,uuid,uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'anon can invoke six-argument legacy reminder overload';
  END IF;
  IF has_function_privilege('anon',
    'public.create_operational_reminder(text,text,timestamptz,text,uuid,uuid,text)','EXECUTE') THEN
    RAISE EXCEPTION 'anon can invoke seven-argument legacy reminder overload';
  END IF;

  IF NOT has_function_privilege('authenticated',
    'public.create_operational_reminder(jsonb)','EXECUTE') THEN
    RAISE EXCEPTION 'current JSONB reminder RPC was accidentally disabled';
  END IF;
  IF NOT has_function_privilege('service_role',
    'public.create_operational_reminder(text,text,timestamptz,text,uuid,uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'trusted service role lost legacy six-argument access';
  END IF;
  IF NOT has_function_privilege('service_role',
    'public.create_operational_reminder(text,text,timestamptz,text,uuid,uuid,text)','EXECUTE') THEN
    RAISE EXCEPTION 'trusted service role lost legacy seven-argument access';
  END IF;
END
$test$;

SET ROLE authenticated;
DO $client_denial$
BEGIN
  BEGIN
    PERFORM public.create_operational_reminder(
      'legacy title', NULL, NULL, 'normal', NULL, NULL
    );
    RAISE EXCEPTION 'legacy six-argument client RPC unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  BEGIN
    PERFORM public.create_operational_reminder(
      'legacy title', NULL, NULL, 'normal', NULL, NULL, 'day'
    );
    RAISE EXCEPTION 'legacy seven-argument client RPC unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  IF public.create_operational_reminder('{"title":"current","priority":"normal"}'::jsonb) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'current JSONB reminder RPC failed for authenticated staff';
  END IF;
END
$client_denial$;
RESET ROLE;

SET ROLE service_role;
DO $trusted_backend$
BEGIN
  IF public.create_operational_reminder(
    'legacy title', NULL, NULL, 'normal', NULL, NULL
  ) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'trusted service role cannot execute legacy six-argument overload';
  END IF;
  IF public.create_operational_reminder(
    'legacy title', NULL, NULL, 'normal', NULL, NULL, 'day'
  ) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'trusted service role cannot execute legacy seven-argument overload';
  END IF;
END
$trusted_backend$;
RESET ROLE;
