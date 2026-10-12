begin;

do $do$
declare
  existing_job record;
begin
  -- The daily job sends yesterday's completed business-day snapshot at 18:30 Tehran.
  for existing_job in
    select jobid from cron.job where jobname='messenger-daily-report-every-day-1830-tehran'
  loop
    perform cron.unschedule(existing_job.jobid);
  end loop;

  perform cron.schedule(
    'messenger-daily-report-every-day-1830-tehran',
    '0 15 * * *',
    $job$
      select net.http_post(
        url := 'https://bjngfgiecvihofemptub.supabase.co/functions/v1/messenger-gateway',
        headers := jsonb_build_object(
          'Content-Type','application/json',
          'x-messenger-path','/api/messenger/reports/daily',
          'x-messenger-outbox-cron-secret',
            (select decrypted_secret from vault.decrypted_secrets where name='messenger_outbox_cron_secret' limit 1)
        ),
        body := '{"source":"pg-cron","mode":"scheduled"}'::jsonb,
        timeout_milliseconds := 20000
      );
    $job$
  );

  -- Retry only failed or stale in-progress reports; never use retry as the normal daily trigger.
  for existing_job in
    select jobid from cron.job where jobname='messenger-daily-report-retry-every-15-minutes'
  loop
    perform cron.unschedule(existing_job.jobid);
  end loop;

  perform cron.schedule(
    'messenger-daily-report-retry-every-15-minutes',
    '*/15 * * * *',
    $job$
      select net.http_post(
        url := 'https://bjngfgiecvihofemptub.supabase.co/functions/v1/messenger-gateway',
        headers := jsonb_build_object(
          'Content-Type','application/json',
          'x-messenger-path','/api/messenger/reports/daily',
          'x-messenger-outbox-cron-secret',
            (select decrypted_secret from vault.decrypted_secrets where name='messenger_outbox_cron_secret' limit 1)
        ),
        body := '{"source":"pg-cron","mode":"retry"}'::jsonb,
        timeout_milliseconds := 20000
      );
    $job$
  );
end;
$do$;

commit;