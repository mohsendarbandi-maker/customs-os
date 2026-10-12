begin;

create or replace function public.messenger_claim_delivery_outbox(p_limit integer default 50)
returns setof public.messenger_delivery_outbox
language sql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
  with picked as (
    select o.id
    from public.messenger_delivery_outbox o
    where o.attempt_count < 12
      and (
        (o.status in ('queued','failed') and o.next_attempt_at <= now())
        or (o.status='sending' and o.updated_at < now() - interval '5 minutes')
      )
    order by o.created_at, o.id
    for update skip locked
    limit greatest(1, least(coalesce(p_limit,50),100))
  )
  update public.messenger_delivery_outbox o
  set status='sending',
      attempt_count=o.attempt_count+1,
      last_error_code=case when o.status='sending' then 'STALE_DELIVERY_RECOVERED' else null end,
      updated_at=now()
  from picked
  where o.id=picked.id
  returning o.*;
$$;
revoke all on function public.messenger_claim_delivery_outbox(integer) from public, anon, authenticated;
grant execute on function public.messenger_claim_delivery_outbox(integer) to service_role;

do $do$
declare
  existing_job record;
begin
  for existing_job in
    select jobid from cron.job where jobname='messenger-delivery-outbox-every-minute'
  loop
    perform cron.unschedule(existing_job.jobid);
  end loop;

  perform cron.schedule(
    'messenger-delivery-outbox-every-minute',
    '* * * * *',
    $job$
      select net.http_post(
        url := 'https://bjngfgiecvihofemptub.supabase.co/functions/v1/messenger-gateway',
        headers := jsonb_build_object(
          'Content-Type','application/json',
          'x-messenger-path','/api/messenger/outbox/process',
          'x-messenger-outbox-cron-secret',
            (select decrypted_secret from vault.decrypted_secrets where name='messenger_outbox_cron_secret' limit 1)
        ),
        body := '{"source":"pg-cron"}'::jsonb,
        timeout_milliseconds := 20000
      );
    $job$
  );
end;
$do$;

commit;