begin;

create table if not exists public.messenger_report_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  messenger_chat_id uuid not null references public.messenger_chats(id) on delete cascade,
  connection_id uuid not null references public.messenger_connections(id) on delete cascade,
  report_date date not null,
  status text not null default 'sending' check (status in ('sending','sent','failed')),
  attempt_count integer not null default 1 check (attempt_count >= 1),
  external_message_id text,
  report_snapshot jsonb,
  error_code text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (messenger_chat_id, report_date)
);

alter table public.messenger_report_runs enable row level security;
revoke all on public.messenger_report_runs from public, anon, authenticated;
grant all on public.messenger_report_runs to service_role;

create index if not exists messenger_report_runs_retry_idx
  on public.messenger_report_runs(status,updated_at)
  where status <> 'sent';

create or replace function public.messenger_report_snapshot(
  p_organization_id uuid,
  p_timezone text default 'Asia/Tehran'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_report_date date;
  v_start timestamptz;
  v_end timestamptz;
  v_total_shipments bigint;
  v_shipments_updated bigint;
  v_total_cases bigint;
  v_cases_created bigint;
  v_declarations_created bigint;
  v_ship_pass_pending bigint;
  v_latest_shipments jsonb;
begin
  if p_organization_id is null then
    raise exception 'REPORT_ORGANIZATION_REQUIRED';
  end if;
  if p_timezone <> 'Asia/Tehran' then
    raise exception 'REPORT_TIMEZONE_NOT_ALLOWED';
  end if;

  v_report_date := (now() at time zone p_timezone)::date - 1;
  v_start := v_report_date::timestamp at time zone p_timezone;
  v_end := (v_report_date + 1)::timestamp at time zone p_timezone;

  select count(*) into v_total_shipments
  from public.shipments s
  where s.organization_id = p_organization_id;

  select count(*) into v_shipments_updated
  from public.shipments s
  where s.organization_id = p_organization_id
    and s.updated_at >= v_start and s.updated_at < v_end;

  select count(*) into v_total_cases
  from public.cases c
  where c.organization_id = p_organization_id;

  select count(*) into v_cases_created
  from public.cases c
  where c.organization_id = p_organization_id
    and c.created_at >= v_start and c.created_at < v_end;

  select count(*) into v_declarations_created
  from public.customs_declarations d
  where d.organization_id = p_organization_id
    and d.created_at >= v_start and d.created_at < v_end;

  select count(*) into v_ship_pass_pending
  from public.shipments s
  where s.organization_id = p_organization_id
    and s.ship_passed is distinct from true;

  select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
  into v_latest_shipments
  from (
    select
      coalesce(nullif(s.display_name,''),nullif(s.bill_of_lading_no,''),'محموله') as display_name,
      s.bill_of_lading_no,
      s.current_status::text as current_status,
      s.current_location,
      s.eta_destination,
      s.updated_at,
      c.case_number,
      c.cargo_description,
      cl.name as client_name
    from public.shipments s
    left join public.cases c
      on c.id = s.case_id and c.organization_id = s.organization_id
    left join public.clients cl
      on cl.id = coalesce(s.client_id,c.client_id) and cl.organization_id = s.organization_id
    where s.organization_id = p_organization_id
      and s.updated_at >= v_start and s.updated_at < v_end
    order by s.updated_at desc, s.id
    limit 8
  ) t;

  return jsonb_build_object(
    'report_date', v_report_date,
    'timezone', p_timezone,
    'total_shipments', v_total_shipments,
    'shipments_updated', v_shipments_updated,
    'total_cases', v_total_cases,
    'cases_created', v_cases_created,
    'declarations_created', v_declarations_created,
    'ship_pass_pending', v_ship_pass_pending,
    'latest_shipments', v_latest_shipments
  );
end;
$$;

revoke all on function public.messenger_report_snapshot(uuid,text) from public, anon, authenticated;
grant execute on function public.messenger_report_snapshot(uuid,text) to service_role;

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
  where public.messenger_report_runs.status='failed'
     or (public.messenger_report_runs.status='sending'
         and public.messenger_report_runs.updated_at < now() - interval '10 minutes')
  returning *;
$$;

revoke all on function public.messenger_claim_daily_report(uuid,uuid,uuid,date) from public, anon, authenticated;
grant execute on function public.messenger_claim_daily_report(uuid,uuid,uuid,date) to service_role;

create or replace function public.messenger_enqueue_chat_delivery()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
begin
  if new.sender_id is null
     or new.message_type not in ('text','file','voice')
     or new.external_platform is not null then
    return new;
  end if;

  insert into public.messenger_delivery_outbox(
    organization_id,connection_id,messenger_chat_id,chat_message_id,
    external_chat_id,status,next_attempt_at
  )
  select
    mc.organization_id,mc.connection_id,mc.id,new.id,mc.external_chat_id,'queued',now()
  from public.messenger_chats mc
  join public.messenger_connections conn
    on conn.id=mc.connection_id
   and conn.organization_id=mc.organization_id
   and conn.enabled=true
  where mc.organization_id=new.organization_id
    and mc.conversation_id=new.conversation_id
    and mc.enabled=true
    and mc.purpose in ('inbox','daily_report','shipment_notifications','shipment')
  on conflict(messenger_chat_id,chat_message_id) do nothing;

  return new;
end;
$$;

revoke all on function public.messenger_enqueue_chat_delivery() from public, anon, authenticated;

do $do$
declare
  existing_job record;
begin
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
        body := '{"source":"pg-cron"}'::jsonb,
        timeout_milliseconds := 20000
      );
    $job$
  );
end;
$do$;

commit;