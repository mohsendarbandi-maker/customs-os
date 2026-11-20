DO $test$
BEGIN
  IF has_function_privilege('authenticated', 'public.sync_case_alert_reminders(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated can still invoke sync_case_alert_reminders';
  END IF;
  IF has_function_privilege('anon', 'public.sync_case_alert_reminders(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon can invoke sync_case_alert_reminders';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.sync_case_alert_reminders(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role lost trusted sync_case_alert_reminders access';
  END IF;
  IF NOT has_function_privilege('postgres', 'public.sync_case_alert_reminders(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'function owner lost sync_case_alert_reminders access';
  END IF;
END
$test$;

SET ROLE authenticated;
DO $direct_denial$
BEGIN
  BEGIN
    PERFORM public.sync_case_alert_reminders(NULL);
    RAISE EXCEPTION 'direct client case-alert synchronization unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END
$direct_denial$;
RESET ROLE;

SET ROLE service_role;
DO $trusted_backend$
BEGIN
  IF public.sync_case_alert_reminders(NULL) <> 0 THEN
    RAISE EXCEPTION 'trusted backend case-alert synchronization failed';
  END IF;
END
$trusted_backend$;
RESET ROLE;
