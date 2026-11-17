-- SQL contract tests for independently managed customs activities.
-- Run after customs_activities_fixture.sql and its migration with ON_ERROR_STOP=1.

set request.jwt.claim.sub = '20000000-0000-0000-0000-000000000001';
set request.jwt.claim.org_id = '10000000-0000-0000-0000-000000000001';
set request.jwt.claim.role = 'broker';
set role authenticated;

do $test$
declare
  v_activity uuid := '70000000-0000-0000-0000-000000000001';
  v_second uuid := '70000000-0000-0000-0000-000000000002';
  v_foreign uuid := '70000000-0000-0000-0000-000000000003';
  v_version integer;
  v_rows integer;
  v_events integer;
  v_linked uuid;
begin
  -- A declaration supplies the shipment relation automatically.
  insert into public.customs_activities(
    id, organization_id, declaration_id, title, created_by, updated_by, assignee_id
  ) values (
    v_activity, '10000000-0000-0000-0000-000000000001',
    '40000000-0000-0000-0000-000000000001',
    'کنترل اسناد حمل', '20000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000003'
  );

  if not exists (
    select 1 from public.customs_activities
    where id = v_activity and shipment_id = '30000000-0000-0000-0000-000000000001'
  ) then
    raise exception 'Declaration did not populate its related shipment';
  end if;

  select version into v_version from public.customs_activities where id = v_activity;
  if v_version <> 1 then raise exception 'New activity version must start at 1'; end if;

  -- Optimistic concurrency: the first write wins; a stale second write affects 0 rows.
  update public.customs_activities
  set title = 'کنترل اسناد اصلاح‌شده'
  where id = v_activity and organization_id = '10000000-0000-0000-0000-000000000001'
    and version = v_version;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then raise exception 'Current activity version update failed'; end if;

  update public.customs_activities
  set description = 'stale write'
  where id = v_activity and organization_id = '10000000-0000-0000-0000-000000000001'
    and version = v_version;
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then raise exception 'Stale activity version must not overwrite current data'; end if;

  select version into v_version from public.customs_activities where id = v_activity;
  if v_version <> 2 then raise exception 'Activity version did not increment exactly once'; end if;

  -- Create another independent activity on the same shipment.
  insert into public.customs_activities(
    id, organization_id, shipment_id, title, created_by, updated_by
  ) values (
    v_second, '10000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000001',
    'پیگیری مجوز بهداشت', '20000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001'
  );

  -- An explicitly declared dependency prevents premature completion only.
  insert into public.customs_activity_dependencies(
    organization_id, prerequisite_activity_id, blocked_activity_id, reason, created_by
  ) values (
    '10000000-0000-0000-0000-000000000001', v_activity, v_second,
    'مجوز باید پیش از تکمیل این فعالیت دریافت شود.',
    '20000000-0000-0000-0000-000000000001'
  );

  begin
    update public.customs_activities set status = 'completed'
    where id = v_second;
    raise exception 'Incomplete prerequisite did not block dependent completion';
  exception when sqlstate '23514' then
    if sqlerrm <> 'CUSTOMS_ACTIVITY_DEPENDENCY_INCOMPLETE' then raise; end if;
  end;

  update public.customs_activities set status = 'completed' where id = v_activity;
  update public.customs_activities set status = 'completed' where id = v_second;
  if not exists (
    select 1 from public.customs_activities
    where id = v_second and status = 'completed' and completed_at is not null
  ) then
    raise exception 'Completed activity timestamp was not set';
  end if;

  update public.customs_activities set status = 'in_progress' where id = v_second;
  if exists (select 1 from public.customs_activities where id = v_second and completed_at is not null) then
    raise exception 'Reopened activity retained a completed timestamp';
  end if;

  -- Cycle rejection: second -> first would close the existing first -> second edge.
  begin
    insert into public.customs_activity_dependencies(
      organization_id, prerequisite_activity_id, blocked_activity_id, created_by
    ) values (
      '10000000-0000-0000-0000-000000000001', v_second, v_activity,
      '20000000-0000-0000-0000-000000000001'
    );
    raise exception 'Dependency cycle unexpectedly succeeded';
  exception when sqlstate '23514' then
    if sqlerrm <> 'CUSTOMS_ACTIVITY_DEPENDENCY_CYCLE' then raise; end if;
  end;

  -- Existing File Asset reuse: no duplicate binary or Storage upload is created.
  insert into public.customs_activity_attachments(
    organization_id, activity_id, file_asset_id, label, added_by
  ) values (
    '10000000-0000-0000-0000-000000000001', v_activity,
    '50000000-0000-0000-0000-000000000001', 'اظهارنامه', '20000000-0000-0000-0000-000000000001'
  );

  -- Cross-organization asset attachment must fail at the composite foreign key.
  begin
    insert into public.customs_activity_attachments(
      organization_id, activity_id, file_asset_id, added_by
    ) values (
      '10000000-0000-0000-0000-000000000001', v_activity,
      '50000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001'
    );
    raise exception 'Cross-tenant file asset attachment unexpectedly succeeded';
  exception when check_violation then
    if sqlerrm <> 'CUSTOMS_ACTIVITY_ATTACHMENT_FILE_NOT_IN_MANAGER' then raise; end if;
  end;

  -- Link an existing finance row. There remains exactly one cost ledger row.
  update public.finance_cost_items
  set customs_activity_id = v_activity,
      updated_by = '20000000-0000-0000-0000-000000000001'
  where id = '60000000-0000-0000-0000-000000000001'
    and organization_id = '10000000-0000-0000-0000-000000000001';
  select customs_activity_id into v_linked from public.finance_cost_items
  where id = '60000000-0000-0000-0000-000000000001';
  if v_linked is distinct from v_activity then raise exception 'Existing finance cost did not link'; end if;

  -- Reminder entity validation and visibility use the existing reminder subsystem.
  if not public.reminder_entity_is_visible(
    '10000000-0000-0000-0000-000000000001', 'customs_activities', v_activity
  ) then raise exception 'A same-tenant activity is not visible to reminder linking'; end if;
  if public.reminder_entity_is_visible(
    '10000000-0000-0000-0000-000000000002', 'customs_activities', v_activity
  ) then raise exception 'A cross-tenant activity passed reminder visibility'; end if;

  insert into public.operational_reminders(
    id, organization_id, title, entity_type, entity_id, created_by
  ) values (
    '80000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'پیگیری فعالیت گمرکی', 'customs_activities', v_activity,
    '20000000-0000-0000-0000-000000000001'
  );

  begin
    insert into public.operational_reminders(
      id, organization_id, title, entity_type, entity_id, created_by
    ) values (
      '80000000-0000-0000-0000-000000000002',
      '10000000-0000-0000-0000-000000000002',
      'Invalid cross-tenant reminder', 'customs_activities', v_activity,
      '20000000-0000-0000-0000-000000000002'
    );
    raise exception 'Cross-tenant reminder link unexpectedly succeeded';
  exception when check_violation then
    if sqlerrm <> 'CUSTOMS_ACTIVITY_REMINDER_LINK_INVALID' then raise; end if;
  end;

  select count(*) into v_events from public.customs_activity_events
  where activity_id = v_activity;
  if v_events < 6 then raise exception 'Expected activity, status, attachment, cost and reminder events; got %', v_events; end if;

  -- A foreign-organization user sees no rows for this activity.
  perform set_config('request.jwt.claim.org_id','10000000-0000-0000-0000-000000000002',false);
  if exists (select 1 from public.customs_activities where id = v_activity) then
    raise exception 'Tenant isolation failed for activities';
  end if;
  perform set_config('request.jwt.claim.org_id','10000000-0000-0000-0000-000000000001',false);

  -- Accountants can read activity state but cannot insert or update activities.
  perform set_config('request.jwt.claim.role','accountant',false);
  if not exists (select 1 from public.customs_activities where id = v_activity) then
    raise exception 'Accountant read access was unexpectedly denied';
  end if;
  begin
    insert into public.customs_activities(
      organization_id, shipment_id, title, created_by, updated_by
    ) values (
      '10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',
      'Unauthorized activity', '20000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000001'
    );
    raise exception 'Accountant unexpectedly created a customs activity';
  exception when insufficient_privilege then null;
  end;

  perform set_config('request.jwt.claim.role','broker',false);

  -- Mismatched declaration/shipment and foreign assignee are rejected.
  begin
    insert into public.customs_activities(
      organization_id, declaration_id, shipment_id, title, created_by, updated_by
    ) values (
      '10000000-0000-0000-0000-000000000001',
      '40000000-0000-0000-0000-000000000001',
      '30000000-0000-0000-0000-000000000002',
      'Mismatched context', '20000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000001'
    );
    raise exception 'Mismatched declaration and shipment unexpectedly succeeded';
  exception when check_violation then
    if sqlerrm <> 'CUSTOMS_ACTIVITY_SHIPMENT_DECLARATION_MISMATCH' then raise; end if;
  end;

  begin
    insert into public.customs_activities(
      organization_id, shipment_id, title, assignee_id, created_by, updated_by
    ) values (
      '10000000-0000-0000-0000-000000000001',
      '30000000-0000-0000-0000-000000000001',
      'Foreign assignee', '20000000-0000-0000-0000-000000000002',
      '20000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000001'
    );
    raise exception 'Cross-tenant assignee unexpectedly succeeded';
  exception when check_violation then
    if sqlerrm <> 'CUSTOMS_ACTIVITY_ASSIGNEE_INVALID' then raise; end if;
  end;
end;
$test$;

reset role;
