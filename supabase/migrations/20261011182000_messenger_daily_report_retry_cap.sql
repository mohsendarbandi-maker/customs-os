begin;

create or replace function public.messenger_claim_daily_report(
  p_organization_id uuid,
  p_messenger_chat_id uuid,
  p_connection_id uuid,
  p_report_date date
)
returns setof public.messenger_report_runs
language sql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
  insert into public.messenger_report_runs(
    organization_id,messenger_chat_id,connection_id,report_date,status,attempt_count
  )
  values (p_organization_id,p_messenger_chat_id,p_connection_id,p_report_date,'sending',1)
  on conflict (messenger_chat_id,report_date) do update
  set status='sending',
      connection_id=excluded.connection_id,
      attempt_count=public.messenger_report_runs.attempt_count+1,
      error_code=null,
      updated_at=now()
  where public.messenger_report_runs.attempt_count < 8
    and (
      public.messenger_report_runs.status='failed'
      or (public.messenger_report_runs.status='sending'
          and public.messenger_report_runs.updated_at < now() - interval '10 minutes')
    )
  returning *;
$$;

revoke all on function public.messenger_claim_daily_report(uuid,uuid,uuid,date) from public, anon, authenticated;
grant execute on function public.messenger_claim_daily_report(uuid,uuid,uuid,date) to service_role;

commit;