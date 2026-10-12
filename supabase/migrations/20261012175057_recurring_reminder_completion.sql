begin;

create or replace function public.complete_operational_reminder(
  p_reminder_id uuid,
  p_next_due_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_actor uuid := auth.uid();
  v_org uuid := public.user_org_id();
  v_role text := public.user_role()::text;
  v_row public.operational_reminders;
  v_next_id uuid;
  v_actual_next_due timestamptz;
  v_series_id uuid;
  v_occurrence_key text;
begin
  if v_actor is null or v_org is null then
    raise exception 'احراز هویت الزامی است';
  end if;

  if not exists (
    select 1
    from public.profiles p
    where p.id = v_actor
      and p.organization_id = v_org
      and p.is_active = true
      and p.role in ('owner', 'admin', 'broker', 'accountant', 'warehouse')
  ) then
    raise exception 'این حساب اجازهٔ تکمیل یادآور داخلی را ندارد';
  end if;

  select r.*
    into v_row
  from public.operational_reminders r
  where r.id = p_reminder_id
    and r.organization_id = v_org
    and r.deleted_at is null
    and (
      v_role in ('owner', 'admin')
      or r.created_by = v_actor
      or r.assignee_id = v_actor
      or (
        r.visibility = 'team'
        and v_role <> 'client'
        and public.reminder_entity_is_visible(r.organization_id, r.entity_type, r.entity_id)
      )
    )
  for update;

  if not found then
    raise exception 'یادآور پیدا نشد یا دسترسی تغییر آن مجاز نیست';
  end if;

  if v_row.status = 'dismissed' then
    raise exception 'یادآور پنهان شده است و قابل تکمیل نیست';
  end if;
  if v_row.status not in ('open', 'done') then
    raise exception 'وضعیت یادآور برای تکمیل معتبر نیست';
  end if;

  if v_row.status = 'open' then
    update public.operational_reminders
       set status = 'done',
           completed_at = coalesce(completed_at, now()),
           completed_by = v_actor
     where id = v_row.id;
  end if;

  if v_row.recurrence_rule is null or v_row.due_at is null then
    if p_next_due_at is not null then
      raise exception 'این یادآور نوبت تکراری ندارد';
    end if;
    return jsonb_build_object(
      'completed', true,
      'next_id', null,
      'next_due_at', null,
      'next_exists', false
    );
  end if;

  if p_next_due_at is null then
    if v_row.recurrence_until is null then
      raise exception 'نوبت بعدی تکرار محاسبه نشد؛ تکمیل یادآور ذخیره نشد';
    end if;
    return jsonb_build_object(
      'completed', true,
      'next_id', null,
      'next_due_at', null,
      'next_exists', false
    );
  end if;

  if p_next_due_at <= v_row.due_at then
    raise exception 'تاریخ نوبت بعدی باید پس از موعد فعلی باشد';
  end if;
  if v_row.recurrence_until is not null and p_next_due_at > v_row.recurrence_until then
    raise exception 'نوبت بعدی از تاریخ پایان تکرار عبور می‌کند';
  end if;

  v_series_id := coalesce(v_row.series_id, v_row.id);
  v_occurrence_key := to_char(
    p_next_due_at at time zone 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  );

  -- A retry or a second device reuses the same occurrence instead of duplicating it.
  select r.id, r.due_at
    into v_next_id, v_actual_next_due
  from public.operational_reminders r
  where r.series_id = v_series_id
    and r.occurrence_key = v_occurrence_key;

  if found then
    return jsonb_build_object(
      'completed', true,
      'next_id', v_next_id,
      'next_due_at', v_actual_next_due,
      'next_exists', true
    );
  end if;

  insert into public.operational_reminders (
    organization_id, case_id, shipment_id, title, description, due_at, priority, status,
    created_by, due_precision, source_key, is_system, kind, entity_type, entity_id, assignee_id,
    visibility, all_day, timezone, alarm_offsets_min, recurrence_rule, recurrence_until,
    series_id, occurrence_key, snoozed_until, snooze_count, tags, notes, client_uuid,
    deleted_at, completed_at, completed_by
  ) values (
    v_org, v_row.case_id, v_row.shipment_id, v_row.title, v_row.description,
    p_next_due_at, v_row.priority, 'open',
    v_actor, v_row.due_precision, null, v_row.is_system, v_row.kind,
    v_row.entity_type, v_row.entity_id, v_row.assignee_id,
    v_row.visibility, v_row.all_day, v_row.timezone, v_row.alarm_offsets_min,
    v_row.recurrence_rule, v_row.recurrence_until,
    v_series_id, v_occurrence_key, null, 0, v_row.tags, v_row.notes, null,
    null, null, null
  )
  on conflict (series_id, occurrence_key)
    where series_id is not null and occurrence_key is not null
    do nothing
  returning id, due_at into v_next_id, v_actual_next_due;

  if v_next_id is null then
    select r.id, r.due_at
      into v_next_id, v_actual_next_due
    from public.operational_reminders r
    where r.series_id = v_series_id
      and r.occurrence_key = v_occurrence_key;
  end if;

  if v_next_id is null then
    raise exception 'نوبت بعدی یادآور ساخته نشد';
  end if;

  return jsonb_build_object(
    'completed', true,
    'next_id', v_next_id,
    'next_due_at', v_actual_next_due,
    'next_exists', true
  );
end;
$function$;

revoke all on function public.complete_operational_reminder(uuid, timestamptz) from public, anon;
grant execute on function public.complete_operational_reminder(uuid, timestamptz) to authenticated, service_role;

commit;
