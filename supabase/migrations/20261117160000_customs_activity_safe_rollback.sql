begin;

-- Add an explicit audit event for safe field-level rollback.
alter table public.customs_activity_events
  drop constraint if exists customs_activity_events_event_type_check;

alter table public.customs_activity_events
  add constraint customs_activity_events_event_type_check
  check (event_type in (
    'created','updated','status_changed','assignee_changed','deadline_changed','rollback',
    'dependency_added','dependency_removed','attachment_added','attachment_removed',
    'cost_linked','cost_unlinked','reminder_linked','reminder_unlinked'
  ));

-- The existing row-history trigger labels the event as rollback only while
-- this transaction-local flag is set by the rollback RPC below.
create or replace function public.log_customs_activity_row_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_changed text[];
  v_type text;
begin
  if tg_op = 'INSERT' then
    perform public.append_customs_activity_event(
      new.organization_id, new.id, 'created',
      array['title','description','activity_type','status','priority','assignee_id','starts_at','due_at','declaration_id','shipment_id'],
      null, to_jsonb(new), coalesce(new.updated_by, new.created_by, auth.uid())
    );
    return new;
  end if;

  select array_agg(e.key order by e.key)
  into v_changed
  from pg_catalog.jsonb_each(to_jsonb(new)) e(key, value)
  where e.key not in ('updated_at','updated_by','version')
    and (to_jsonb(old) -> e.key) is distinct from e.value;

  if coalesce(array_length(v_changed, 1), 0) = 0 then return new; end if;

  v_type := case
    when current_setting('customs.activity_rollback', true) = 'true' then 'rollback'
    when old.status is distinct from new.status then 'status_changed'
    when old.assignee_id is distinct from new.assignee_id then 'assignee_changed'
    when old.due_at is distinct from new.due_at then 'deadline_changed'
    else 'updated'
  end;

  perform public.append_customs_activity_event(
    new.organization_id, new.id, v_type, v_changed,
    to_jsonb(old), to_jsonb(new), coalesce(new.updated_by, auth.uid())
  );
  return new;
end;
$function$;

-- SECURITY INVOKER: tenant isolation and mutation permissions continue to be
-- enforced by the same RLS policies used by ordinary activity updates.
-- Rollback is deliberately limited to the latest compatible activity version.
create or replace function public.rollback_customs_activity_event(
  p_event_id uuid,
  p_expected_version integer
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_org_id uuid := public.user_org_id();
  v_role text := coalesce(public.user_role()::text, '');
  v_event public.customs_activity_events%rowtype;
  v_activity public.customs_activities%rowtype;
  v_allowed text[] := array[
    'title','description','activity_type','status','priority',
    'assignee_id','starts_at','due_at'
  ]::text[];
  v_field text;
  v_fields text[] := '{}'::text[];
  v_current jsonb;
  v_result jsonb;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'CUSTOMS_ACTIVITY_AUTH_REQUIRED';
  end if;

  if v_org_id is null or v_role not in ('owner','admin','broker','warehouse') then
    raise exception using errcode = '42501', message = 'CUSTOMS_ACTIVITY_ROLLBACK_FORBIDDEN';
  end if;

  if p_expected_version is null or p_expected_version < 1 then
    raise exception using errcode = '22023', message = 'CUSTOMS_ACTIVITY_ROLLBACK_VERSION_REQUIRED';
  end if;

  select e.* into v_event
  from public.customs_activity_events e
  where e.id = p_event_id
    and e.organization_id = v_org_id
    and e.event_type in ('updated','status_changed','assignee_changed','deadline_changed')
    and e.previous_snapshot is not null
  for share;

  if not found then
    raise exception using errcode = 'P0002', message = 'CUSTOMS_ACTIVITY_ROLLBACK_EVENT_NOT_FOUND';
  end if;

  select a.* into v_activity
  from public.customs_activities a
  where a.id = v_event.activity_id
    and a.organization_id = v_org_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'CUSTOMS_ACTIVITY_NOT_FOUND';
  end if;

  if v_activity.version <> p_expected_version then
    raise exception using
      errcode = '40001',
      message = 'CUSTOMS_ACTIVITY_ROLLBACK_VERSION_CONFLICT',
      detail = pg_catalog.format('expected=%s current=%s', p_expected_version, v_activity.version);
  end if;

  if coalesce(pg_catalog.array_length(v_event.changed_fields, 1), 0) = 0 then
    raise exception using errcode = '22023', message = 'CUSTOMS_ACTIVITY_ROLLBACK_NO_FIELDS';
  end if;

  -- completed_at is a derived timestamp managed by the status trigger. It is
  -- validated via the before/after snapshots but recalculated by the trigger.
  foreach v_field in array v_event.changed_fields loop
    if v_field = 'completed_at' then
      continue;
    end if;

    if not (v_field = any(v_allowed)) then
      raise exception using
        errcode = '22023',
        message = 'CUSTOMS_ACTIVITY_ROLLBACK_UNSUPPORTED_FIELD',
        detail = v_field;
    end if;

    if (to_jsonb(v_activity) -> v_field)
       is distinct from (v_event.snapshot -> v_field) then
      raise exception using
        errcode = '40001',
        message = 'CUSTOMS_ACTIVITY_ROLLBACK_FIELD_CONFLICT',
        detail = v_field;
    end if;

    v_fields := pg_catalog.array_append(v_fields, v_field);
  end loop;

  if coalesce(pg_catalog.array_length(v_fields, 1), 0) = 0 then
    raise exception using errcode = '22023', message = 'CUSTOMS_ACTIVITY_ROLLBACK_NO_REVERSIBLE_FIELDS';
  end if;

  perform pg_catalog.set_config('customs.activity_rollback', 'true', true);

  update public.customs_activities
  set
    title = case when 'title' = any(v_fields) then v_event.previous_snapshot ->> 'title' else title end,
    description = case when 'description' = any(v_fields) then v_event.previous_snapshot ->> 'description' else description end,
    activity_type = case when 'activity_type' = any(v_fields) then v_event.previous_snapshot ->> 'activity_type' else activity_type end,
    status = case when 'status' = any(v_fields) then v_event.previous_snapshot ->> 'status' else status end,
    priority = case when 'priority' = any(v_fields) then v_event.previous_snapshot ->> 'priority' else priority end,
    assignee_id = case when 'assignee_id' = any(v_fields) then (v_event.previous_snapshot ->> 'assignee_id')::uuid else assignee_id end,
    starts_at = case when 'starts_at' = any(v_fields) then (v_event.previous_snapshot ->> 'starts_at')::timestamptz else starts_at end,
    due_at = case when 'due_at' = any(v_fields) then (v_event.previous_snapshot ->> 'due_at')::timestamptz else due_at end,
    updated_by = v_user_id
  where id = v_activity.id
    and organization_id = v_org_id
    and version = p_expected_version
  returning * into v_activity;

  if not found then
    raise exception using
      errcode = '40001',
      message = 'CUSTOMS_ACTIVITY_ROLLBACK_VERSION_CONFLICT';
  end if;

  v_result := pg_catalog.to_jsonb(v_activity);
  return v_result;
end;
$function$;

revoke all on function public.rollback_customs_activity_event(uuid, integer) from public, anon;
grant execute on function public.rollback_customs_activity_event(uuid, integer) to authenticated;

commit;
