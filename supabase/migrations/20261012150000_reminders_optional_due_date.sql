begin;
-- Due dates are optional; existing reminder rows are preserved.
alter table public.operational_reminders alter column due_at drop not null;
create or replace function public.set_operational_reminder_org() returns trigger language plpgsql security definer set search_path to 'public','pg_catalog','pg_temp' as $function$
begin
 if auth.uid() is null then raise exception 'کاربر وارد سامانه نشده است'; end if; new.organization_id:=public.user_org_id(); if new.organization_id is null then raise exception 'سازمان کاربر مشخص نیست'; end if;
 new.created_by:=coalesce(new.created_by,auth.uid()); if new.created_by<>auth.uid() and public.user_role() not in ('owner','admin') then raise exception 'خالق یادآور معتبر نیست'; end if;
 new.assignee_id:=coalesce(new.assignee_id,new.created_by); new.timezone:=coalesce(nullif(new.timezone,''),'Asia/Tehran'); new.alarm_offsets_min:=coalesce(nullif(new.alarm_offsets_min,'{}'::integer[]),array[0]::integer[]);
 if new.series_id is null then new.series_id:=new.id; end if; if new.occurrence_key is null and new.due_at is not null then new.occurrence_key:=to_char(new.due_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'); end if;
 return new;
end; $function$;
create or replace function public.sync_operational_reminder_deliveries() returns trigger language plpgsql security definer set search_path to 'public','pg_catalog','pg_temp' as $function$
declare v_user uuid; v_fire timestamptz; v_offset integer; v_nag integer; v_recipients uuid[];
begin
 if new.status<>'open' or new.deleted_at is not null then update public.reminder_deliveries set status='skipped' where reminder_id=new.id and status='pending'; return new; end if;
 if new.due_at is null then update public.reminder_deliveries set status='skipped' where reminder_id=new.id and status='pending'; return new; end if;
 if new.snoozed_until is not null and new.snoozed_until>now() then update public.reminder_deliveries set status='skipped' where reminder_id=new.id and status='pending'; v_recipients:=array[new.assignee_id];
  foreach v_user in array v_recipients loop if v_user is not null then insert into public.reminder_deliveries(reminder_id,user_id,fire_at,status) values(new.id,v_user,new.snoozed_until,'pending') on conflict do nothing; end if; end loop; return new;
 end if;
 if new.visibility='team' then select coalesce(array_agg(p.id),'{}'::uuid[]) into v_recipients from public.profiles p where p.organization_id=new.organization_id and p.is_active=true and p.role<>'client'; else v_recipients:=array[new.assignee_id]; end if;
 foreach v_user in array v_recipients loop if v_user is null then continue; end if;
  foreach v_offset in array coalesce(new.alarm_offsets_min,array[0]::integer[]) loop v_fire:=new.due_at-make_interval(mins=>v_offset); insert into public.reminder_deliveries(reminder_id,user_id,fire_at,status) values(new.id,v_user,v_fire,'pending') on conflict do nothing; end loop;
  select coalesce(overdue_nag_minutes,120) into v_nag from public.notification_preferences where user_id=v_user; v_nag:=coalesce(v_nag,120);
  for i in 1..3 loop insert into public.reminder_deliveries(reminder_id,user_id,fire_at,status) values(new.id,v_user,new.due_at+make_interval(mins=>v_nag*i),'pending') on conflict do nothing; end loop;
 end loop; return new;
end; $function$;
create or replace function public.create_operational_reminder(p_payload jsonb)
returns public.operational_reminders
language plpgsql
security definer
set search_path to 'public', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_user uuid := auth.uid();
  v_org uuid := public.user_org_id();
  v_role text := public.user_role();
  v_row public.operational_reminders;
  v_title text := nullif(trim(p_payload->>'title'), '');
  v_due timestamptz;
  v_client_uuid uuid;
  v_entity_id uuid;
  v_assignee uuid;
  v_case uuid;
  v_shipment uuid;
  v_shipment_case uuid;
  v_offsets integer[];
  v_priority text := coalesce(nullif(p_payload->>'priority', ''), 'normal');
  v_kind text := coalesce(nullif(p_payload->>'kind', ''), 'other');
  v_visibility text := coalesce(nullif(p_payload->>'visibility', ''), 'private');
begin
  if v_user is null or v_org is null then
    raise exception 'احراز هویت الزامی است';
  end if;

  if not exists (
    select 1 from public.profiles p
    where p.id = v_user
      and p.organization_id = v_org
      and p.is_active = true
      and p.role in ('owner', 'admin', 'broker', 'accountant', 'warehouse')
  ) then
    raise exception 'این حساب اجازه ثبت یادآور داخلی را ندارد';
  end if;

  if jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception 'اطلاعات یادآور نامعتبر است';
  end if;
  if v_title is null then raise exception 'عنوان یادآور الزامی است'; end if;

  if nullif(p_payload->>'due_at', '') is not null then
    begin
      v_due := (p_payload->>'due_at')::timestamptz;
    exception when others then
      raise exception 'زمان یادآور نامعتبر است';
    end;
  end if;

  begin v_client_uuid := nullif(p_payload->>'client_uuid', '')::uuid;
  exception when others then raise exception 'شناسه محلی یادآور نامعتبر است'; end;
  begin v_entity_id := nullif(p_payload->>'entity_id', '')::uuid;
  exception when others then raise exception 'شناسه موجودیت نامعتبر است'; end;
  begin v_assignee := coalesce(nullif(p_payload->>'assignee_id', '')::uuid, v_user);
  exception when others then raise exception 'مسئول نامعتبر است'; end;
  begin v_case := nullif(p_payload->>'case_id', '')::uuid;
  exception when others then raise exception 'شناسه پرونده نامعتبر است'; end;
  begin v_shipment := nullif(p_payload->>'shipment_id', '')::uuid;
  exception when others then raise exception 'شناسه محموله نامعتبر است'; end;

  if v_priority not in ('low', 'normal', 'high', 'urgent') then
    raise exception 'اولویت یادآور نامعتبر است';
  end if;
  if v_kind not in ('document', 'shipment', 'finance', 'other') then
    raise exception 'دسته یادآور نامعتبر است';
  end if;
  if v_visibility not in ('private', 'team') then
    raise exception 'دامنه نمایش یادآور نامعتبر است';
  end if;

  if v_case is not null and not exists (
    select 1 from public.cases c where c.id = v_case and c.organization_id = v_org
  ) then
    raise exception 'پرونده انتخاب‌شده متعلق به سازمان شما نیست';
  end if;

  if v_shipment is not null then
    select s.case_id into v_shipment_case
    from public.shipments s
    where s.id = v_shipment and s.organization_id = v_org;

    if not found then
      raise exception 'محموله انتخاب‌شده متعلق به سازمان شما نیست';
    end if;

    if v_case is not null and v_shipment_case is not null and v_case <> v_shipment_case then
      raise exception 'پرونده انتخابی با محموله انتخابی مطابقت ندارد';
    end if;
    v_case := coalesce(v_case, v_shipment_case);
  end if;

  if not exists (
    select 1 from public.profiles p
    where p.id = v_assignee
      and p.organization_id = v_org
      and p.is_active = true
      and p.role <> 'client'
  ) then
    raise exception 'مسئول یادآور معتبر نیست';
  end if;

  if v_entity_id is not null
    and not public.reminder_entity_is_visible(v_org, nullif(p_payload->>'entity_type', ''), v_entity_id)
  then
    raise exception 'موجودیت پیوندشده قابل استفاده نیست';
  end if;

  select coalesce(array_agg(value::integer), '{}'::integer[])
  into v_offsets
  from jsonb_array_elements_text(coalesce(p_payload->'alarm_offsets_min', '[]'::jsonb)) x(value);

  if exists (select 1 from unnest(v_offsets) offset_min where offset_min < 0 or offset_min > 525600) then
    raise exception 'زمان هشدار یادآور نامعتبر است';
  end if;

  if cardinality(v_offsets) = 0 then
    select default_offsets into v_offsets
    from public.notification_preferences where user_id = v_user;
    v_offsets := coalesce(v_offsets, array[0]::integer[]);
  end if;

  insert into public.operational_reminders(
    organization_id, case_id, shipment_id, title, description, due_at, priority, status,
    created_by, due_precision, source_key, is_system, kind, entity_type, entity_id, assignee_id,
    visibility, all_day, timezone, alarm_offsets_min, recurrence_rule, recurrence_until,
    series_id, occurrence_key, tags, notes, client_uuid
  ) values (
    v_org, v_case, v_shipment, v_title, nullif(p_payload->>'description', ''), v_due, v_priority, 'open',
    v_user, 'day', nullif(p_payload->>'source_key', ''), coalesce((p_payload->>'is_system')::boolean, false),
    v_kind, nullif(p_payload->>'entity_type', ''), v_entity_id, v_assignee,
    v_visibility, coalesce((p_payload->>'all_day')::boolean, false),
    coalesce(nullif(p_payload->>'timezone', ''), 'Asia/Tehran'), v_offsets,
    nullif(p_payload->>'recurrence_rule', ''), nullif(p_payload->>'recurrence_until', '')::timestamptz,
    nullif(p_payload->>'series_id', '')::uuid, nullif(p_payload->>'occurrence_key', ''),
    coalesce((select array_agg(value) from jsonb_array_elements_text(coalesce(p_payload->'tags', '[]'::jsonb)) t(value)), '{}'::text[]),
    nullif(p_payload->>'notes', ''), v_client_uuid
  )
  on conflict(created_by, client_uuid) where client_uuid is not null
    do update set updated_at = public.operational_reminders.updated_at
  returning * into v_row;

  return v_row;
end;
$function$;

revoke all on function public.create_operational_reminder(jsonb) from public, anon;
grant execute on function public.create_operational_reminder(jsonb) to authenticated, service_role;

create or replace function public.create_operational_reminder(p_title text,p_description text default null,p_due_at timestamptz default null,p_priority text default 'normal',p_case_id uuid default null,p_shipment_id uuid default null,p_due_precision text default 'day')
returns public.operational_reminders language plpgsql security definer set search_path to 'public','pg_catalog','pg_temp' as $function$
declare v_org uuid; v_row public.operational_reminders; v_precision text:=coalesce(p_due_precision,'day');
begin
 if auth.uid() is null then raise exception 'کاربر وارد سامانه نشده است'; end if; select organization_id into v_org from public.profiles where id=auth.uid() and is_active=true; if v_org is null then raise exception 'سازمان کاربر مشخص نیست'; end if;
 if nullif(trim(p_title),'') is null then raise exception 'عنوان Reminder الزامی است'; end if; if p_priority not in ('low','normal','high','urgent') then raise exception 'اولویت نامعتبر است'; end if; if v_precision not in ('month','day') then raise exception 'نوع تاریخ Reminder نامعتبر است'; end if;
 if p_case_id is not null and not exists(select 1 from public.cases c where c.id=p_case_id and c.organization_id=v_org) then raise exception 'پرونده انتخاب‌شده متعلق به سازمان شما نیست'; end if;
 if p_shipment_id is not null and not exists(select 1 from public.shipments s where s.id=p_shipment_id and s.organization_id=v_org) then raise exception 'محموله انتخاب‌شده متعلق به سازمان شما نیست'; end if;
 insert into public.operational_reminders(organization_id,case_id,shipment_id,title,description,due_at,due_precision,priority,status,created_by) values(v_org,p_case_id,p_shipment_id,trim(p_title),nullif(trim(coalesce(p_description,'')),''),p_due_at,v_precision,p_priority,'open',auth.uid()) returning * into v_row; return v_row;
end; $function$;
create or replace function public.create_operational_reminder(p_title text,p_description text default null,p_due_at timestamptz default null,p_priority text default 'normal',p_case_id uuid default null,p_shipment_id uuid default null)
returns public.operational_reminders language plpgsql security definer set search_path to 'public','pg_catalog','pg_temp' as $function$
declare v_org uuid; v_row public.operational_reminders;
begin
 if auth.uid() is null then raise exception 'کاربر وارد سامانه نشده است'; end if; select organization_id into v_org from public.profiles where id=auth.uid() and is_active=true; if v_org is null then raise exception 'سازمان کاربر مشخص نیست'; end if;
 if nullif(trim(p_title),'') is null then raise exception 'عنوان Reminder الزامی است'; end if; if p_priority not in ('low','normal','high','urgent') then raise exception 'اولویت نامعتبر است'; end if;
 if p_case_id is not null and not exists(select 1 from public.cases c where c.id=p_case_id and c.organization_id=v_org) then raise exception 'پرونده انتخاب‌شده متعلق به سازمان شما نیست'; end if;
 if p_shipment_id is not null and not exists(select 1 from public.shipments s where s.id=p_shipment_id and s.organization_id=v_org) then raise exception 'محموله انتخاب‌شده متعلق به سازمان شما نیست'; end if;
 insert into public.operational_reminders(organization_id,case_id,shipment_id,title,description,due_at,priority,status,created_by) values(v_org,p_case_id,p_shipment_id,trim(p_title),nullif(trim(coalesce(p_description,'')),''),p_due_at,p_priority,'open',auth.uid()) returning * into v_row; return v_row;
end; $function$;
revoke all on function public.create_operational_reminder(jsonb) from public,anon;
revoke all on function public.create_operational_reminder(text,text,timestamptz,text,uuid,uuid,text) from public,anon;
revoke all on function public.create_operational_reminder(text,text,timestamptz,text,uuid,uuid) from public,anon;
grant execute on function public.create_operational_reminder(jsonb) to authenticated,service_role;
grant execute on function public.create_operational_reminder(text,text,timestamptz,text,uuid,uuid,text) to authenticated,service_role;
grant execute on function public.create_operational_reminder(text,text,timestamptz,text,uuid,uuid) to authenticated,service_role;
commit;
