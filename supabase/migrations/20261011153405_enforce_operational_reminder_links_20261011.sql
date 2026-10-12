begin;

create or replace function public.reminder_entity_is_visible(
  p_organization_id uuid,
  p_entity_type text,
  p_entity_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog', 'pg_temp'
as $function$
begin
  if auth.uid() is null
     or public.user_org_id() is distinct from p_organization_id
     or public.user_role() = 'client' then
    return false;
  end if;

  if p_entity_type is null or p_entity_id is null then
    return true;
  end if;

  if p_entity_type in ('cases','case') then
    return exists(select 1 from public.cases x where x.id=p_entity_id and x.organization_id=p_organization_id);
  elsif p_entity_type in ('shipments','shipment') then
    return exists(select 1 from public.shipments x where x.id=p_entity_id and x.organization_id=p_organization_id);
  elsif p_entity_type='customs_documents' then
    return exists(select 1 from public.customs_documents x where x.id=p_entity_id and x.organization_id=p_organization_id);
  elsif p_entity_type='shipment_documents' then
    return exists(select 1 from public.shipment_documents x join public.shipments s on s.id=x.shipment_id where x.id=p_entity_id and x.organization_id=p_organization_id);
  elsif p_entity_type='documents' then
    return exists(select 1 from public.documents x where x.id=p_entity_id and x.organization_id=p_organization_id);
  elsif p_entity_type='finance_invoices' then
    return exists(select 1 from public.finance_invoices x where x.id=p_entity_id and x.organization_id=p_organization_id);
  elsif p_entity_type='clients' then
    return exists(select 1 from public.clients x where x.id=p_entity_id and x.organization_id=p_organization_id);
  end if;

  return false;
end;
$function$;

revoke all on function public.reminder_entity_is_visible(uuid,text,uuid) from public, anon;
grant execute on function public.reminder_entity_is_visible(uuid,text,uuid) to authenticated, service_role;

do $constraints$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.operational_reminders'::regclass
      and conname='operational_reminders_entity_pair_check'
  ) then
    alter table public.operational_reminders
      add constraint operational_reminders_entity_pair_check
      check (
        (entity_type is null and entity_id is null)
        or (entity_type is not null and entity_id is not null)
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid='public.operational_reminders'::regclass
      and conname='operational_reminders_entity_type_check'
  ) then
    alter table public.operational_reminders
      add constraint operational_reminders_entity_type_check
      check (
        entity_type is null
        or entity_type = any(array[
          'customs_documents','shipment_documents','documents',
          'shipments','cases','finance_invoices','clients'
        ]::text[])
      );
  end if;
end;
$constraints$;

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

  begin
    v_due := (p_payload->>'due_at')::timestamptz;
  exception when others then
    raise exception 'زمان یادآور نامعتبر است';
  end;
  if v_due is null then raise exception 'زمان یادآور الزامی است'; end if;

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

commit;
