-- Customs OS — Reminders model / RLS / delivery engine baseline
-- Idempotent migration. Live baseline is 20261002000000_operational_reminders_baseline.sql.

create extension if not exists pg_cron;
create extension if not exists pg_net;

alter table public.operational_reminders
  add column if not exists kind text not null default 'other',
  add column if not exists entity_type text,
  add column if not exists entity_id uuid,
  add column if not exists assignee_id uuid,
  add column if not exists visibility text not null default 'private',
  add column if not exists all_day boolean not null default false,
  add column if not exists timezone text not null default 'Asia/Tehran',
  add column if not exists alarm_offsets_min integer[] not null default array[0]::integer[],
  add column if not exists recurrence_rule text,
  add column if not exists recurrence_until timestamptz,
  add column if not exists series_id uuid,
  add column if not exists occurrence_key text,
  add column if not exists snoozed_until timestamptz,
  add column if not exists snooze_count integer not null default 0,
  add column if not exists tags text[] not null default array[]::text[],
  add column if not exists notes text,
  add column if not exists client_uuid uuid,
  add column if not exists deleted_at timestamptz,
  add column if not exists completed_by uuid;

create table if not exists public.reminder_checklist_items (
  id uuid primary key default gen_random_uuid(),
  reminder_id uuid not null references public.operational_reminders(id) on delete cascade,
  title text not null,
  is_done boolean not null default false,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.notification_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  push_enabled boolean not null default false,
  quiet_start time not null default time '22:00',
  quiet_end time not null default time '07:00',
  morning_digest_time time not null default time '08:00',
  default_offsets integer[] not null default array[0]::integer[],
  overdue_nag_minutes integer not null default 120,
  hide_content boolean not null default false,
  timezone text not null default 'Asia/Tehran',
  updated_at timestamptz not null default now()
);

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  platform text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_success_at timestamptz,
  failure_count integer not null default 0,
  is_active boolean not null default true
);

create table if not exists public.reminder_deliveries (
  reminder_id uuid not null references public.operational_reminders(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  fire_at timestamptz not null,
  status text not null default 'pending',
  attempts integer not null default 0,
  sent_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  primary key (reminder_id,user_id,fire_at)
);

create index if not exists operational_reminders_org_assignee_status_due_idx
  on public.operational_reminders(organization_id,assignee_id,status,due_at)
  where deleted_at is null;

create index if not exists operational_reminders_org_deleted_due_idx
  on public.operational_reminders(organization_id,deleted_at,due_at);

create index if not exists operational_reminders_org_entity_idx
  on public.operational_reminders(organization_id,entity_type,entity_id);

create unique index if not exists operational_reminders_created_by_client_uuid_uidx
  on public.operational_reminders(created_by,client_uuid) where client_uuid is not null;

create unique index if not exists operational_reminders_series_occurrence_uidx
  on public.operational_reminders(series_id,occurrence_key)
  where series_id is not null and occurrence_key is not null;

alter table public.reminder_checklist_items enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.reminder_deliveries enable row level security;

drop policy if exists reminder_checklist_select on public.reminder_checklist_items;
drop policy if exists reminder_checklist_insert on public.reminder_checklist_items;
drop policy if exists reminder_checklist_update on public.reminder_checklist_items;
drop policy if exists reminder_checklist_delete on public.reminder_checklist_items;

create or replace function public.reminder_can_manage(p_reminder_id uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_catalog, pg_temp
as $$
  select exists(
    select 1 from public.operational_reminders r
    where r.id=p_reminder_id
      and r.organization_id=public.user_org_id()
      and (
        public.user_role() in ('owner','admin')
        or r.created_by=auth.uid()
        or r.assignee_id=auth.uid()
      )
  );
$$;

revoke all on function public.reminder_can_manage(uuid) from public,anon,authenticated;
grant execute on function public.reminder_can_manage(uuid) to authenticated;

create or replace function public.reminder_entity_is_visible(
  p_organization_id uuid,p_entity_type text,p_entity_id uuid
)
returns boolean
language plpgsql stable security definer
set search_path = public, pg_catalog, pg_temp
as $$
begin
  if auth.uid() is null
     or public.user_org_id() is distinct from p_organization_id
     or public.user_role()='client' then return false; end if;
  if p_entity_type is null or p_entity_id is null then return true; end if;
  if p_entity_type in ('cases','case') then
    return exists(select 1 from public.cases x where x.id=p_entity_id and x.organization_id=p_organization_id);
  elsif p_entity_type in ('shipments','shipment') then
    return exists(select 1 from public.shipments x where x.id=p_entity_id and x.organization_id=p_organization_id);
  elsif p_entity_type='customs_documents' then
    return exists(select 1 from public.customs_documents x where x.id=p_entity_id and x.organization_id=p_organization_id);
  elsif p_entity_type='shipment_documents' then
    return exists(select 1 from public.shipment_documents x where x.id=p_entity_id and x.organization_id=p_organization_id);
  elsif p_entity_type='documents' then
    return exists(select 1 from public.documents x where x.id=p_entity_id and x.organization_id=p_organization_id);
  elsif p_entity_type='finance_invoices' then
    return exists(select 1 from public.finance_invoices x where x.id=p_entity_id and x.organization_id=p_organization_id);
  elsif p_entity_type='clients' then
    return exists(select 1 from public.clients x where x.id=p_entity_id and x.organization_id=p_organization_id);
  end if;
  return false;
end;
$$;

revoke all on function public.reminder_entity_is_visible(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.reminder_entity_is_visible(uuid,text,uuid) to authenticated;

create or replace function public.set_operational_reminder_org()
returns trigger
language plpgsql security definer
set search_path = public, pg_catalog, pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'کاربر وارد سامانه نشده است'; end if;
  new.organization_id:=public.user_org_id();
  if new.organization_id is null then raise exception 'سازمان کاربر مشخص نیست'; end if;
  new.created_by:=coalesce(new.created_by,auth.uid());
  if new.created_by<>auth.uid() and public.user_role() not in ('owner','admin') then
    raise exception 'خالق یادآور معتبر نیست';
  end if;
  new.assignee_id:=coalesce(new.assignee_id,new.created_by);
  new.timezone:=coalesce(nullif(new.timezone,''),'Asia/Tehran');
  new.alarm_offsets_min:=coalesce(nullif(new.alarm_offsets_min,'{}'::integer[]),array[0]::integer[]);
  new.series_id:=coalesce(new.series_id,new.id);
  new.occurrence_key:=coalesce(
    new.occurrence_key,
    to_char(new.due_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
  return new;
end;
$$;

create or replace function public.validate_operational_reminder_links()
returns trigger
language plpgsql security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare v_org uuid;
begin
  if tg_op='UPDATE'
     and new.created_by is distinct from old.created_by
     and public.user_role() not in ('owner','admin') then
    raise exception 'خالق یادآور قابل تغییر نیست';
  end if;

  if new.case_id is not null then
    select organization_id into v_org from public.cases where id=new.case_id;
    if v_org is null or v_org<>new.organization_id then raise exception 'پرونده متعلق به سازمان جاری نیست'; end if;
  end if;

  if new.shipment_id is not null then
    select organization_id into v_org from public.shipments where id=new.shipment_id;
    if v_org is null or v_org<>new.organization_id then raise exception 'محموله متعلق به سازمان جاری نیست'; end if;
  end if;

  if new.entity_id is not null and new.entity_type is not null then
    if not public.reminder_entity_is_visible(new.organization_id,new.entity_type,new.entity_id)
       and public.user_role() not in ('owner','admin') then
      raise exception 'موجودیت پیوندشده قابل استفاده نیست';
    end if;
    if new.entity_type in ('shipments','shipment') then
      new.shipment_id:=new.entity_id;
    elsif new.entity_type in ('cases','case') then
      new.case_id:=new.entity_id;
    elsif new.entity_type='customs_documents' then
      select d.case_id,d.shipment_id into new.case_id,new.shipment_id
      from public.customs_documents d
      where d.id=new.entity_id and d.organization_id=new.organization_id;
    elsif new.entity_type='shipment_documents' then
      select sd.shipment_id into new.shipment_id
      from public.shipment_documents sd
      where sd.id=new.entity_id and sd.organization_id=new.organization_id;
    end if;
  end if;

  if new.assignee_id is not null
     and not exists(
       select 1 from public.profiles p
       where p.id=new.assignee_id
         and p.organization_id=new.organization_id
         and p.is_active=true
         and p.role<>'client'
     ) then raise exception 'مسئول یادآور معتبر نیست'; end if;

  if cardinality(new.alarm_offsets_min)>8
     or exists(select 1 from unnest(new.alarm_offsets_min) x where x is null or x<0 or x>10080) then
    raise exception 'زمان هشدار نامعتبر است';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_validate_operational_reminder_links on public.operational_reminders;
create trigger trg_validate_operational_reminder_links
before insert or update on public.operational_reminders
for each row execute function public.validate_operational_reminder_links();

drop policy if exists operational_reminders_select on public.operational_reminders;
drop policy if exists operational_reminders_insert on public.operational_reminders;
drop policy if exists operational_reminders_update on public.operational_reminders;
drop policy if exists operational_reminders_delete on public.operational_reminders;

create policy operational_reminders_select on public.operational_reminders
for select to authenticated
using(
  organization_id=public.user_org_id()
  and deleted_at is null
  and public.user_role()<>'client'
  and (
    public.user_role() in ('owner','admin')
    or created_by=auth.uid()
    or assignee_id=auth.uid()
    or (visibility='team' and public.user_role()<>'client')
  )
  and public.reminder_entity_is_visible(organization_id,entity_type,entity_id)
);

create policy operational_reminders_insert on public.operational_reminders
for insert to authenticated
with check(
  organization_id=public.user_org_id()
  and created_by=auth.uid()
  and public.user_role()<>'client'
);

create policy operational_reminders_update on public.operational_reminders
for update to authenticated
using(
  organization_id=public.user_org_id()
  and (public.user_role() in ('owner','admin') or created_by=auth.uid() or assignee_id=auth.uid())
)
with check(
  organization_id=public.user_org_id()
  and (public.user_role() in ('owner','admin') or created_by=auth.uid() or assignee_id=auth.uid())
);

create policy operational_reminders_delete on public.operational_reminders
for delete to authenticated
using(
  organization_id=public.user_org_id()
  and (public.user_role() in ('owner','admin') or created_by=auth.uid() or assignee_id=auth.uid())
);

create policy reminder_checklist_select on public.reminder_checklist_items
for select to authenticated using(public.reminder_can_manage(reminder_id));
create policy reminder_checklist_insert on public.reminder_checklist_items
for insert to authenticated with check(public.reminder_can_manage(reminder_id));
create policy reminder_checklist_update on public.reminder_checklist_items
for update to authenticated using(public.reminder_can_manage(reminder_id))
with check(public.reminder_can_manage(reminder_id));
create policy reminder_checklist_delete on public.reminder_checklist_items
for delete to authenticated using(public.reminder_can_manage(reminder_id));

drop policy if exists notification_preferences_select on public.notification_preferences;
drop policy if exists notification_preferences_insert on public.notification_preferences;
drop policy if exists notification_preferences_update on public.notification_preferences;
drop policy if exists notification_preferences_delete on public.notification_preferences;
create policy notification_preferences_select on public.notification_preferences for select to authenticated using(user_id=auth.uid());
create policy notification_preferences_insert on public.notification_preferences for insert to authenticated with check(user_id=auth.uid());
create policy notification_preferences_update on public.notification_preferences for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy notification_preferences_delete on public.notification_preferences for delete to authenticated using(user_id=auth.uid());

drop policy if exists push_subscriptions_select on public.push_subscriptions;
drop policy if exists push_subscriptions_insert on public.push_subscriptions;
drop policy if exists push_subscriptions_update on public.push_subscriptions;
drop policy if exists push_subscriptions_delete on public.push_subscriptions;
create policy push_subscriptions_select on public.push_subscriptions for select to authenticated using(user_id=auth.uid());
create policy push_subscriptions_insert on public.push_subscriptions for insert to authenticated with check(user_id=auth.uid() and organization_id=public.user_org_id());
create policy push_subscriptions_update on public.push_subscriptions for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid() and organization_id=public.user_org_id());
create policy push_subscriptions_delete on public.push_subscriptions for delete to authenticated using(user_id=auth.uid());

drop policy if exists reminder_deliveries_select on public.reminder_deliveries;
create policy reminder_deliveries_select on public.reminder_deliveries for select to authenticated using(user_id=auth.uid());

create or replace function public.create_operational_reminder(p_payload jsonb)
returns public.operational_reminders
language plpgsql security definer
set search_path=public,pg_catalog,pg_temp
as $$
declare
  v_user uuid:=auth.uid();
  v_org uuid:=public.user_org_id();
  v_row public.operational_reminders;
  v_title text:=nullif(trim(p_payload->>'title'),'');
  v_due timestamptz;
  v_client_uuid uuid;
  v_entity_id uuid;
  v_assignee uuid;
  v_offsets integer[];
begin
  if v_user is null or v_org is null then raise exception 'احراز هویت الزامی است'; end if;
  if public.user_role()='client' then raise exception 'صاحب کالا امکان ثبت یادآور داخلی ندارد'; end if;
  if v_title is null then raise exception 'عنوان یادآور الزامی است'; end if;
  begin v_due:=(p_payload->>'due_at')::timestamptz; exception when others then raise exception 'زمان یادآور نامعتبر است'; end;
  if v_due is null then raise exception 'زمان یادآور الزامی است'; end if;
  begin v_client_uuid:=nullif(p_payload->>'client_uuid','')::uuid; exception when others then raise exception 'شناسه محلی نامعتبر است'; end;
  begin v_entity_id:=nullif(p_payload->>'entity_id','')::uuid; exception when others then raise exception 'شناسه موجودیت نامعتبر است'; end;
  begin v_assignee:=coalesce(nullif(p_payload->>'assignee_id','')::uuid,v_user); exception when others then raise exception 'مسئول نامعتبر است'; end;

  if not exists(select 1 from public.profiles p where p.id=v_assignee and p.organization_id=v_org and p.is_active=true and p.role<>'client') then
    raise exception 'مسئول یادآور معتبر نیست';
  end if;

  if v_entity_id is not null and not public.reminder_entity_is_visible(v_org,nullif(p_payload->>'entity_type',''),v_entity_id) then
    raise exception 'موجودیت پیوندشده قابل استفاده نیست';
  end if;

  select coalesce(array_agg(value::integer),'{}'::integer[])
  into v_offsets
  from jsonb_array_elements_text(coalesce(p_payload->'alarm_offsets_min','[]'::jsonb)) x(value);

  if cardinality(v_offsets)=0 then
    select default_offsets into v_offsets from public.notification_preferences where user_id=v_user;
    v_offsets:=coalesce(v_offsets,array[0]::integer[]);
  end if;

  insert into public.operational_reminders(
    organization_id,case_id,shipment_id,title,description,due_at,priority,status,created_by,due_precision,
    source_key,is_system,kind,entity_type,entity_id,assignee_id,visibility,all_day,timezone,alarm_offsets_min,
    recurrence_rule,recurrence_until,series_id,occurrence_key,tags,notes,client_uuid
  )
  values(
    v_org,nullif(p_payload->>'case_id','')::uuid,nullif(p_payload->>'shipment_id','')::uuid,
    v_title,nullif(p_payload->>'description',''),v_due,coalesce(nullif(p_payload->>'priority',''),'normal'),'open',v_user,'day',
    nullif(p_payload->>'source_key',''),coalesce((p_payload->>'is_system')::boolean,false),
    coalesce(nullif(p_payload->>'kind',''),'other'),nullif(p_payload->>'entity_type',''),v_entity_id,v_assignee,
    coalesce(nullif(p_payload->>'visibility',''),'private'),coalesce((p_payload->>'all_day')::boolean,false),
    coalesce(nullif(p_payload->>'timezone',''),'Asia/Tehran'),v_offsets,nullif(p_payload->>'recurrence_rule',''),
    nullif(p_payload->>'recurrence_until','')::timestamptz,nullif(p_payload->>'series_id','')::uuid,
    nullif(p_payload->>'occurrence_key',''),
    coalesce((select array_agg(value) from jsonb_array_elements_text(coalesce(p_payload->'tags','[]'::jsonb)) t(value)),'{}'::text[]),
    nullif(p_payload->>'notes',''),v_client_uuid
  )
  on conflict(created_by,client_uuid) where client_uuid is not null
  do update set updated_at=public.operational_reminders.updated_at
  returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.create_operational_reminder(jsonb) from public,anon;
grant execute on function public.create_operational_reminder(jsonb) to authenticated;

create or replace function public.upsert_push_subscription(p_endpoint text,p_p256dh text,p_auth text,p_user_agent text default null,p_platform text default null)
returns public.push_subscriptions
language plpgsql security definer
set search_path=public,pg_catalog,pg_temp
as $$
declare v_user uuid:=auth.uid(); v_org uuid:=public.user_org_id(); v_row public.push_subscriptions;
begin
  if v_user is null or v_org is null then raise exception 'احراز هویت الزامی است'; end if;
  if public.user_role()='client' then raise exception 'صاحب کالا امکان فعال‌سازی اعلان داخلی ندارد'; end if;
  if p_endpoint is null or p_endpoint !~ '^https://' or p_p256dh is null or p_auth is null then raise exception 'اطلاعات اشتراک اعلان ناقص است'; end if;

  if not exists(select 1 from public.push_subscriptions s where s.endpoint=p_endpoint and s.user_id=v_user)
     and (select count(*) from public.push_subscriptions s where s.user_id=v_user and s.created_at>now()-interval '1 hour')>=20 then
    raise exception 'تعداد ثبت دستگاه‌ها در این ساعت بیش از حد مجاز است';
  end if;

  insert into public.push_subscriptions(
    organization_id,user_id,endpoint,p256dh,auth,user_agent,platform,last_seen_at,is_active
  )
  values(v_org,v_user,p_endpoint,p_p256dh,p_auth,p_user_agent,p_platform,now(),true)
  on conflict(endpoint) do update set
    organization_id=excluded.organization_id,user_id=excluded.user_id,p256dh=excluded.p256dh,auth=excluded.auth,
    user_agent=excluded.user_agent,platform=excluded.platform,last_seen_at=now(),is_active=true,failure_count=0
  returning * into v_row;

  insert into public.notification_preferences(user_id) values(v_user) on conflict(user_id) do nothing;
  return v_row;
end;
$$;

revoke all on function public.upsert_push_subscription(text,text,text,text,text) from public,anon;
grant execute on function public.upsert_push_subscription(text,text,text,text,text) to authenticated;

create or replace function public.claim_reminder_deliveries(p_limit integer default 100)
returns table(
  reminder_id uuid,user_id uuid,fire_at timestamptz,attempts integer,title text,description text,
  priority text,due_at timestamptz,timezone text,snoozed_until timestamptz,hide_content boolean,push_enabled boolean
)
language plpgsql security definer
set search_path=public,pg_catalog,pg_temp
as $$
begin
  return query
  with claimed as(
    select d.ctid
    from public.reminder_deliveries d
    where d.status='pending' and d.fire_at<=now() and d.attempts<4
    order by d.fire_at
    for update skip locked
    limit greatest(1,least(coalesce(p_limit,100),500))
  )
  update public.reminder_deliveries d
  set attempts=d.attempts+1
  from claimed c
  join public.operational_reminders r on r.id=d.reminder_id
  left join public.notification_preferences np on np.user_id=d.user_id
  where d.ctid=c.ctid
  returning
    d.reminder_id,d.user_id,d.fire_at,d.attempts,r.title,r.description,r.priority,r.due_at,r.timezone,r.snoozed_until,
    coalesce(np.hide_content,false),coalesce(np.push_enabled,false);
end;
$$;

revoke all on function public.claim_reminder_deliveries(integer) from public,anon,authenticated;
grant execute on function public.claim_reminder_deliveries(integer) to service_role;

create or replace function public.finish_reminder_delivery(
  p_reminder_id uuid,p_user_id uuid,p_fire_at timestamptz,p_status text,p_error text default null,p_retry_at timestamptz default null
)
returns void
language plpgsql security definer
set search_path=public,pg_catalog,pg_temp
as $$
begin
  if p_status='sent' then
    update public.reminder_deliveries set status='sent',sent_at=now(),error=null
    where reminder_id=p_reminder_id and user_id=p_user_id and fire_at=p_fire_at;
    update public.push_subscriptions set last_success_at=now(),last_seen_at=now(),failure_count=0
    where user_id=p_user_id and is_active=true;
  elsif p_status='pending' and p_retry_at is not null then
    update public.reminder_deliveries set status='pending',fire_at=p_retry_at,error=p_error
    where reminder_id=p_reminder_id and user_id=p_user_id and fire_at=p_fire_at;
  elsif p_status='skipped' then
    update public.reminder_deliveries set status='skipped',error=p_error
    where reminder_id=p_reminder_id and user_id=p_user_id and fire_at=p_fire_at;
  else
    update public.reminder_deliveries set status='failed',error=p_error
    where reminder_id=p_reminder_id and user_id=p_user_id and fire_at=p_fire_at;
  end if;
end;
$$;

revoke all on function public.finish_reminder_delivery(uuid,uuid,timestamptz,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.finish_reminder_delivery(uuid,uuid,timestamptz,text,text,timestamptz) to service_role;

create index if not exists reminder_deliveries_pending_fire_idx on public.reminder_deliveries(status,fire_at);
create index if not exists reminder_deliveries_user_fire_idx on public.reminder_deliveries(user_id,fire_at desc);
create index if not exists push_subscriptions_user_active_idx on public.push_subscriptions(user_id,is_active);
create index if not exists reminder_checklist_items_reminder_idx on public.reminder_checklist_items(reminder_id,position,created_at);

do $$
begin
  begin alter publication supabase_realtime add table public.operational_reminders;
  exception when duplicate_object then null; end;
end
$$;

do $$
declare v_job_id bigint;
begin
  if exists(select 1 from pg_extension where extname='pg_cron') and exists(select 1 from pg_extension where extname='pg_net') then
    for v_job_id in select jobid from cron.job where jobname='send-reminders-every-minute' loop
      perform cron.unschedule(v_job_id);
    end loop;
    perform cron.schedule(
      'send-reminders-every-minute','* * * * *',
      $cron$
      select net.http_post(
        url := 'https://bjngfgiecvihofemptub.supabase.co/functions/v1/send-reminders',
        headers := jsonb_build_object(
          'Content-Type','application/json',
          'x-reminder-scheduler','pg-cron'
        ),
        body := '{"mode":"cron"}'::jsonb
      );
      $cron$
    );
  end if;
exception when undefined_table then null;
end
$$;
