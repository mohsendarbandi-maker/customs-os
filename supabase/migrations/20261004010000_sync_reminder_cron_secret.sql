-- Align the repository migration with the live reminder scheduler.
-- Live Supabase already uses reminder_cron_secret from Vault; this migration makes future environments identical.

do $$
declare
  v_job_id bigint;
begin
  if exists(select 1 from pg_extension where extname='pg_cron')
     and exists(select 1 from pg_extension where extname='pg_net') then
    for v_job_id in
      select jobid from cron.job where jobname='send-reminders-every-minute'
    loop
      perform cron.unschedule(v_job_id);
    end loop;

    perform cron.schedule(
      'send-reminders-every-minute',
      '* * * * *',
      $cron$
      select net.http_post(
        url := 'https://bjngfgiecvihofemptub.supabase.co/functions/v1/send-reminders',
        headers := jsonb_build_object(
          'Content-Type','application/json',
          'x-reminder-cron-secret',
          (select decrypted_secret from vault.decrypted_secrets where name='reminder_cron_secret'),
          'x-reminder-scheduler','pg-cron'
        ),
        body := '{"mode":"cron"}'::jsonb
      );
      $cron$
    );
  end if;
end
$$;
