begin;

-- Independent customs activities are operational work items, not another
-- workflow-stage chain. No legacy workflow or live operational row is rewritten.
create table public.customs_activities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  declaration_id uuid,
  shipment_id uuid,
  activity_type text not null default 'general'
    check (activity_type ~ '^[a-z0-9][a-z0-9_:-]{0,63}$'),
  title text not null
    check (char_length(btrim(title)) between 2 and 240),
  description text,
  status text not null default 'open'
    check (status in ('open','in_progress','waiting','blocked','completed','cancelled')),
  priority text not null default 'normal'
    check (priority in ('low','normal','high','urgent')),
  assignee_id uuid,
  starts_at timestamptz,
  due_at timestamptz,
  completed_at timestamptz,
  source text not null default 'manual'
    check (source in ('manual','workflow','system')),
  source_key text,
  version integer not null default 1 check (version > 0),
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint customs_activities_tenant_id_key unique (id, organization_id),
  constraint customs_activities_has_parent_context check (
    declaration_id is not null or shipment_id is not null
  ),
  constraint customs_activities_declaration_tenant_fk
    foreign key (declaration_id, organization_id)
    references public.customs_declarations(id, organization_id) on delete restrict,
  constraint customs_activities_shipment_tenant_fk
    foreign key (shipment_id, organization_id)
    references public.shipments(id, organization_id) on delete restrict,
  constraint customs_activities_assignee_tenant_fk
    foreign key (assignee_id, organization_id)
    references public.profiles(id, organization_id) on delete set null (assignee_id),
  constraint customs_activities_creator_tenant_fk
    foreign key (created_by, organization_id)
    references public.profiles(id, organization_id) on delete set null (created_by),
  constraint customs_activities_updater_tenant_fk
    foreign key (updated_by, organization_id)
    references public.profiles(id, organization_id) on delete set null (updated_by)
);

create unique index customs_activities_source_key_uidx
  on public.customs_activities (organization_id, source, source_key)
  where source_key is not null;
create index customs_activities_org_status_due_idx
  on public.customs_activities (organization_id, status, due_at);
create index customs_activities_org_assignee_due_idx
  on public.customs_activities (organization_id, assignee_id, due_at)
  where assignee_id is not null;
create index customs_activities_declaration_idx
  on public.customs_activities (organization_id, declaration_id)
  where declaration_id is not null;
create index customs_activities_shipment_idx
  on public.customs_activities (organization_id, shipment_id)
  where shipment_id is not null;

alter table public.customs_activities enable row level security;
grant select, insert, update on public.customs_activities to authenticated;

create policy customs_activities_select on public.customs_activities
  for select to authenticated
  using (
    organization_id = (select public.user_org_id())
    and (select public.user_role()::text) = any (array['owner','admin','broker','warehouse','accountant'])
  );

create policy customs_activities_insert on public.customs_activities
  for insert to authenticated
  with check (
    organization_id = (select public.user_org_id())
    and (select public.user_role()::text) = any (array['owner','admin','broker','warehouse'])
  );

create policy customs_activities_update on public.customs_activities
  for update to authenticated
  using (
    organization_id = (select public.user_org_id())
    and (select public.user_role()::text) = any (array['owner','admin','broker','warehouse'])
  )
  with check (
    organization_id = (select public.user_org_id())
    and (select public.user_role()::text) = any (array['owner','admin','broker','warehouse'])
  );

-- Explicit dependencies are opt-in. Nothing is chained merely because it is a
-- familiar customs stage. Edges mean "prerequisite blocks dependent activity".
create table public.customs_activity_dependencies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  prerequisite_activity_id uuid not null,
  blocked_activity_id uuid not null,
  reason text,
  created_by uuid,
  created_at timestamptz not null default clock_timestamp(),
  constraint customs_activity_dependencies_not_self
    check (prerequisite_activity_id <> blocked_activity_id),
  constraint customs_activity_dependencies_unique
    unique (organization_id, prerequisite_activity_id, blocked_activity_id),
  constraint customs_activity_dependencies_prerequisite_tenant_fk
    foreign key (prerequisite_activity_id, organization_id)
    references public.customs_activities(id, organization_id) on delete cascade,
  constraint customs_activity_dependencies_blocked_tenant_fk
    foreign key (blocked_activity_id, organization_id)
    references public.customs_activities(id, organization_id) on delete cascade,
  constraint customs_activity_dependencies_creator_tenant_fk
    foreign key (created_by, organization_id)
    references public.profiles(id, organization_id) on delete set null (created_by)
);

create index customs_activity_dependencies_blocked_idx
  on public.customs_activity_dependencies (organization_id, blocked_activity_id);

alter table public.customs_activity_dependencies enable row level security;
grant select, insert, delete on public.customs_activity_dependencies to authenticated;

create policy customs_activity_dependencies_select on public.customs_activity_dependencies
  for select to authenticated
  using (
    organization_id = (select public.user_org_id())
    and (select public.user_role()::text) = any (array['owner','admin','broker','warehouse','accountant'])
  );
create policy customs_activity_dependencies_insert on public.customs_activity_dependencies
  for insert to authenticated
  with check (
    organization_id = (select public.user_org_id())
    and created_by = (select auth.uid())
    and (select public.user_role()::text) = any (array['owner','admin','broker','warehouse'])
  );
create policy customs_activity_dependencies_delete on public.customs_activity_dependencies
  for delete to authenticated
  using (
    organization_id = (select public.user_org_id())
    and (select public.user_role()::text) = any (array['owner','admin','broker','warehouse'])
  );

-- Attach an existing File Asset; file bytes are not copied or uploaded again.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.file_assets'::regclass
      and conname = 'file_assets_id_organization_id_key'
  ) then
    alter table public.file_assets
      add constraint file_assets_id_organization_id_key unique (id, organization_id);
  end if;
end
$$;

create table public.customs_activity_attachments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  activity_id uuid not null,
  file_asset_id uuid not null,
  label text,
  document_type text not null default 'other'
    check (document_type ~ '^[a-z0-9][a-z0-9_:-]{0,63}$'),
  added_by uuid,
  created_at timestamptz not null default clock_timestamp(),
  constraint customs_activity_attachments_unique unique (organization_id, activity_id, file_asset_id),
  constraint customs_activity_attachments_activity_tenant_fk
    foreign key (activity_id, organization_id)
    references public.customs_activities(id, organization_id) on delete cascade,
  constraint customs_activity_attachments_asset_tenant_fk
    foreign key (file_asset_id, organization_id)
    references public.file_assets(id, organization_id) on delete restrict,
  constraint customs_activity_attachments_actor_tenant_fk
    foreign key (added_by, organization_id)
    references public.profiles(id, organization_id) on delete set null (added_by)
);

create index customs_activity_attachments_activity_idx
  on public.customs_activity_attachments (organization_id, activity_id, created_at desc);

create or replace function public.validate_customs_activity_attachment()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_activity_shipment uuid;
  v_file_shipment uuid;
begin
  select a.shipment_id into v_activity_shipment
  from public.customs_activities a
  where a.id = new.activity_id and a.organization_id = new.organization_id;

  if not found then
    raise exception using errcode = '23503', message = 'CUSTOMS_ACTIVITY_NOT_FOUND';
  end if;

  select f.shipment_id into v_file_shipment
  from public.file_manager_files f
  where f.organization_id = new.organization_id
    and f.file_asset_id = new.file_asset_id
  limit 1;

  if not found then
    raise exception using errcode = '23514', message = 'CUSTOMS_ACTIVITY_ATTACHMENT_FILE_NOT_IN_MANAGER';
  end if;

  if v_activity_shipment is not null
     and v_file_shipment is distinct from v_activity_shipment then
    raise exception using errcode = '23514', message = 'CUSTOMS_ACTIVITY_ATTACHMENT_SHIPMENT_MISMATCH';
  end if;

  return new;
end;
$function$;

revoke all on function public.validate_customs_activity_attachment() from public, anon, authenticated;
create trigger trg_validate_customs_activity_attachment
before insert or update on public.customs_activity_attachments
for each row execute function public.validate_customs_activity_attachment();

alter table public.customs_activity_attachments enable row level security;
grant select, insert, delete on public.customs_activity_attachments to authenticated;

create policy customs_activity_attachments_select on public.customs_activity_attachments
  for select to authenticated
  using (
    organization_id = (select public.user_org_id())
    and (select public.user_role()::text) = any (array['owner','admin','broker','warehouse','accountant'])
  );
create policy customs_activity_attachments_insert on public.customs_activity_attachments
  for insert to authenticated
  with check (
    organization_id = (select public.user_org_id())
    and added_by = (select auth.uid())
    and (select public.user_role()::text) = any (array['owner','admin','broker','warehouse'])
  );
create policy customs_activity_attachments_delete on public.customs_activity_attachments
  for delete to authenticated
  using (
    organization_id = (select public.user_org_id())
    and (select public.user_role()::text) = any (array['owner','admin','broker','warehouse'])
  );

-- Immutable activity history. The only writer is the narrowly scoped trigger
-- function below; normal authenticated clients receive SELECT only.
create table public.customs_activity_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  activity_id uuid not null,
  event_type text not null check (event_type in (
    'created','updated','status_changed','assignee_changed','deadline_changed',
    'dependency_added','dependency_removed','attachment_added','attachment_removed',
    'cost_linked','cost_unlinked','reminder_linked','reminder_unlinked'
  )),
  changed_fields text[] not null default '{}'::text[],
  previous_snapshot jsonb,
  snapshot jsonb not null default '{}'::jsonb,
  actor_id uuid,
  created_at timestamptz not null default clock_timestamp(),
  constraint customs_activity_events_activity_tenant_fk
    foreign key (activity_id, organization_id)
    references public.customs_activities(id, organization_id) on delete cascade,
  constraint customs_activity_events_actor_tenant_fk
    foreign key (actor_id, organization_id)
    references public.profiles(id, organization_id) on delete set null (actor_id)
);

create index customs_activity_events_activity_timeline_idx
  on public.customs_activity_events (organization_id, activity_id, created_at desc);

alter table public.customs_activity_events enable row level security;
grant select on public.customs_activity_events to authenticated;
create policy customs_activity_events_select on public.customs_activity_events
  for select to authenticated
  using (
    organization_id = (select public.user_org_id())
    and (select public.user_role()::text) = any (array['owner','admin','broker','warehouse','accountant'])
  );

create or replace function public.append_customs_activity_event(
  p_organization_id uuid,
  p_activity_id uuid,
  p_event_type text,
  p_changed_fields text[],
  p_previous_snapshot jsonb,
  p_snapshot jsonb,
  p_actor_id uuid default null
)
returns void
language sql
security definer
set search_path = ''
as $function$
  insert into public.customs_activity_events (
    organization_id, activity_id, event_type, changed_fields,
    previous_snapshot, snapshot, actor_id
  ) values (
    p_organization_id, p_activity_id, p_event_type,
    coalesce(p_changed_fields, '{}'::text[]),
    p_previous_snapshot, coalesce(p_snapshot, '{}'::jsonb),
    p_actor_id
  );
$function$;

revoke all on function public.append_customs_activity_event(uuid,uuid,text,text[],jsonb,jsonb,uuid)
  from public, anon, authenticated;

create or replace function public.prepare_customs_activity_write()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_declaration_shipment uuid;
begin
  if auth.uid() is not null then
    if new.organization_id is distinct from public.user_org_id() then
      raise exception using errcode = '42501', message = 'CUSTOMS_ACTIVITY_ORGANIZATION_MISMATCH';
    end if;
  end if;

  if new.declaration_id is not null then
    select d.shipment_id into v_declaration_shipment
    from public.customs_declarations d
    where d.id = new.declaration_id and d.organization_id = new.organization_id;

    if not found then
      raise exception using errcode = '23503', message = 'CUSTOMS_ACTIVITY_DECLARATION_NOT_FOUND';
    end if;

    if new.shipment_id is null then
      new.shipment_id := v_declaration_shipment;
    elsif v_declaration_shipment is not null
       and new.shipment_id is distinct from v_declaration_shipment then
      raise exception using errcode = '23514', message = 'CUSTOMS_ACTIVITY_SHIPMENT_DECLARATION_MISMATCH';
    end if;
  end if;

  if new.assignee_id is not null and not exists (
    select 1 from public.profiles p
    where p.id = new.assignee_id
      and p.organization_id = new.organization_id
      and p.is_active = true
      and p.role::text <> 'client'
  ) then
    raise exception using errcode = '23514', message = 'CUSTOMS_ACTIVITY_ASSIGNEE_INVALID';
  end if;

  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, auth.uid());
    new.updated_by := coalesce(new.updated_by, auth.uid());
    new.version := 1;
    new.created_at := coalesce(new.created_at, clock_timestamp());
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.version := old.version + 1;
    new.updated_by := coalesce(auth.uid(), new.updated_by);
  end if;

  new.updated_at := clock_timestamp();
  if new.status = 'completed' and exists (
    select 1
    from public.customs_activity_dependencies d
    join public.customs_activities prerequisite
      on prerequisite.id = d.prerequisite_activity_id
     and prerequisite.organization_id = d.organization_id
    where d.organization_id = new.organization_id
      and d.blocked_activity_id = new.id
      and prerequisite.status <> 'completed'
  ) then
    raise exception using errcode = '23514', message = 'CUSTOMS_ACTIVITY_DEPENDENCY_INCOMPLETE';
  end if;

  if new.status = 'completed' then
    new.completed_at := coalesce(new.completed_at, clock_timestamp());
  else
    new.completed_at := null;
  end if;

  return new;
end;
$function$;

create trigger trg_prepare_customs_activity_write
before insert or update on public.customs_activities
for each row execute function public.prepare_customs_activity_write();

create or replace function public.guard_customs_activity_dependency()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_cycle boolean;
begin
  -- Serialize graph mutations per tenant. Locking only the two endpoint
  -- rows is insufficient when concurrent edges on disjoint endpoints could
  -- jointly close a cycle. This transaction-scoped advisory lock makes every
  -- dependency insertion/deletion graph check observe the latest committed graph.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.organization_id::text, 0)
  );

  -- Lock endpoints in stable order after obtaining the tenant graph lock.
  perform a.id
  from public.customs_activities a
  where a.organization_id = new.organization_id
    and a.id in (new.prerequisite_activity_id, new.blocked_activity_id)
  order by a.id
  for update;

  with recursive reachable(id) as (
    select new.blocked_activity_id
    union
    select d.blocked_activity_id
    from public.customs_activity_dependencies d
    join reachable r on d.prerequisite_activity_id = r.id
    where d.organization_id = new.organization_id
  )
  select exists (
    select 1 from reachable where id = new.prerequisite_activity_id
  ) into v_cycle;

  if v_cycle then
    raise exception using errcode = '23514', message = 'CUSTOMS_ACTIVITY_DEPENDENCY_CYCLE';
  end if;

  if exists (
    select 1
    from public.customs_activities blocked
    join public.customs_activities prerequisite
      on prerequisite.id = new.prerequisite_activity_id
     and prerequisite.organization_id = new.organization_id
    where blocked.id = new.blocked_activity_id
      and blocked.organization_id = new.organization_id
      and blocked.status = 'completed'
      and prerequisite.status <> 'completed'
  ) then
    raise exception using errcode = '23514', message = 'CUSTOMS_ACTIVITY_DEPENDENCY_COMPLETION_CONFLICT';
  end if;

  return new;
end;
$function$;

create trigger trg_guard_customs_activity_dependency
before insert or update on public.customs_activity_dependencies
for each row execute function public.guard_customs_activity_dependency();

create or replace function public.guard_customs_activity_completion()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if new.status = 'completed' and old.status is distinct from 'completed'
     and exists (
       select 1
       from public.customs_activity_dependencies d
       join public.customs_activities prerequisite
         on prerequisite.id = d.prerequisite_activity_id
        and prerequisite.organization_id = d.organization_id
       where d.organization_id = new.organization_id
         and d.blocked_activity_id = new.id
         and prerequisite.status <> 'completed'
     ) then
    raise exception using errcode = '23514', message = 'CUSTOMS_ACTIVITY_DEPENDENCY_INCOMPLETE';
  end if;
  return new;
end;
$function$;

create trigger trg_guard_customs_activity_completion
before update of status on public.customs_activities
for each row execute function public.guard_customs_activity_completion();

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
      array['title','description','status','priority','assignee_id','starts_at','due_at','declaration_id','shipment_id'],
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

revoke all on function public.prepare_customs_activity_write() from public, anon, authenticated;
revoke all on function public.guard_customs_activity_dependency() from public, anon, authenticated;
revoke all on function public.guard_customs_activity_completion() from public, anon, authenticated;
revoke all on function public.log_customs_activity_row_event() from public, anon, authenticated;

create trigger trg_log_customs_activity_row_event
after insert or update on public.customs_activities
for each row execute function public.log_customs_activity_row_event();

create or replace function public.log_customs_activity_attachment_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_row record;
  v_event text;
begin
  if tg_op = 'DELETE' then
    v_row := old;
    v_event := 'attachment_removed';
  else
    v_row := new;
    v_event := 'attachment_added';
  end if;

  perform public.append_customs_activity_event(
    v_row.organization_id,
    v_row.activity_id,
    v_event,
    array['file_asset_id','label','document_type'],
    case when tg_op = 'DELETE' then to_jsonb(v_row) else null end,
    case when tg_op = 'DELETE' then '{}'::jsonb else to_jsonb(v_row) end,
    coalesce(v_row.added_by, auth.uid())
  );
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$function$;

revoke all on function public.log_customs_activity_attachment_event() from public, anon, authenticated;

create trigger trg_log_customs_activity_attachment_event
after insert or delete on public.customs_activity_attachments
for each row execute function public.log_customs_activity_attachment_event();

create or replace function public.log_customs_activity_dependency_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_row record;
  v_event text;
begin
  if tg_op = 'DELETE' then
    v_row := old;
    v_event := 'dependency_removed';
  else
    v_row := new;
    v_event := 'dependency_added';
  end if;

  perform public.append_customs_activity_event(
    v_row.organization_id,
    v_row.blocked_activity_id,
    v_event,
    array['prerequisite_activity_id','reason'],
    case when tg_op = 'DELETE' then to_jsonb(v_row) else null end,
    case when tg_op = 'DELETE' then '{}'::jsonb else to_jsonb(v_row) end,
    coalesce(v_row.created_by, auth.uid())
  );
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$function$;

revoke all on function public.log_customs_activity_dependency_event() from public, anon, authenticated;

create trigger trg_log_customs_activity_dependency_event
after insert or delete on public.customs_activity_dependencies
for each row execute function public.log_customs_activity_dependency_event();

-- A finance cost remains a single row in the existing ledger; the new FK only
-- associates it with one optional customs activity.
alter table public.finance_cost_items
  add column if not exists customs_activity_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.finance_cost_items'::regclass
      and conname = 'finance_cost_items_customs_activity_tenant_fk'
  ) then
    alter table public.finance_cost_items
      add constraint finance_cost_items_customs_activity_tenant_fk
      foreign key (customs_activity_id, organization_id)
      references public.customs_activities(id, organization_id)
      on delete restrict;
  end if;
end
$$;

create index if not exists finance_cost_items_customs_activity_idx
  on public.finance_cost_items (organization_id, customs_activity_id)
  where customs_activity_id is not null;

create or replace function public.validate_customs_activity_finance_link()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_activity_shipment uuid;
begin
  if new.customs_activity_id is null then return new; end if;

  select a.shipment_id into v_activity_shipment
  from public.customs_activities a
  where a.id = new.customs_activity_id
    and a.organization_id = new.organization_id;

  if not found or v_activity_shipment is null
     or new.shipment_id is distinct from v_activity_shipment then
    raise exception using errcode = '23514', message = 'CUSTOMS_ACTIVITY_FINANCE_SHIPMENT_MISMATCH';
  end if;

  return new;
end;
$function$;

revoke all on function public.validate_customs_activity_finance_link() from public, anon, authenticated;
create trigger trg_validate_customs_activity_finance_link
before insert or update of customs_activity_id, shipment_id, organization_id on public.finance_cost_items
for each row execute function public.validate_customs_activity_finance_link();

create or replace function public.log_customs_activity_finance_link()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if tg_op = 'UPDATE' and old.customs_activity_id is not distinct from new.customs_activity_id then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.customs_activity_id is not null then
    perform public.append_customs_activity_event(
      old.organization_id, old.customs_activity_id, 'cost_unlinked',
      array['customs_activity_id'], to_jsonb(old.customs_activity_id),
      '{}'::jsonb, coalesce(new.updated_by, auth.uid())
    );
  end if;

  if new.customs_activity_id is not null then
    perform public.append_customs_activity_event(
      new.organization_id, new.customs_activity_id, 'cost_linked',
      array['customs_activity_id'], '{}'::jsonb,
      jsonb_build_object('cost_id', new.id), coalesce(new.updated_by, auth.uid())
    );
  end if;
  return new;
end;
$function$;

revoke all on function public.log_customs_activity_finance_link() from public, anon, authenticated;
create trigger trg_log_customs_activity_finance_link
after insert or update of customs_activity_id on public.finance_cost_items
for each row execute function public.log_customs_activity_finance_link();

-- Reuse the reminder table's polymorphic entity link rather than creating a
-- second reminder store. The visibility helper is extended with this entity.
alter table public.operational_reminders
  drop constraint if exists operational_reminders_entity_type_check;
alter table public.operational_reminders
  add constraint operational_reminders_entity_type_check
  check (
    entity_type is null or entity_type = any (
      array['customs_documents','shipment_documents','documents','shipments',
        'cases','finance_invoices','clients','customs_activities']::text[]
    )
  );

create index if not exists operational_reminders_customs_activity_idx
  on public.operational_reminders (organization_id, entity_id, due_at)
  where entity_type = 'customs_activities' and deleted_at is null;

create or replace function public.reminder_entity_is_visible(
  p_organization_id uuid,
  p_entity_type text,
  p_entity_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if auth.uid() is null
     or public.user_org_id() is distinct from p_organization_id
     or public.user_role()::text = 'client' then
    return false;
  end if;

  if p_entity_type is null or p_entity_id is null then return true; end if;
  if p_entity_type in ('cases','case') then
    return exists (select 1 from public.cases x where x.id=p_entity_id and x.organization_id=p_organization_id);
  elsif p_entity_type in ('shipments','shipment') then
    return exists (select 1 from public.shipments x where x.id=p_entity_id and x.organization_id=p_organization_id);
  elsif p_entity_type='customs_documents' then
    return exists (select 1 from public.customs_documents x where x.id=p_entity_id and x.organization_id=p_organization_id);
  elsif p_entity_type='shipment_documents' then
    return exists (
      select 1 from public.shipment_documents x
      join public.shipments s on s.id=x.shipment_id
      where x.id=p_entity_id and x.organization_id=p_organization_id
    );
  elsif p_entity_type='documents' then
    return exists (select 1 from public.documents x where x.id=p_entity_id and x.organization_id=p_organization_id);
  elsif p_entity_type='finance_invoices' then
    return exists (select 1 from public.finance_invoices x where x.id=p_entity_id and x.organization_id=p_organization_id);
  elsif p_entity_type='clients' then
    return exists (select 1 from public.clients x where x.id=p_entity_id and x.organization_id=p_organization_id);
  elsif p_entity_type='customs_activities' then
    return exists (
      select 1 from public.customs_activities x
      where x.id=p_entity_id and x.organization_id=p_organization_id
    );
  end if;

  return false;
end;
$function$;

create or replace function public.validate_customs_activity_reminder_link()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_activity_shipment uuid;
  v_shipment_case uuid;
begin
  if new.entity_type = 'customs_activities' then
    select a.shipment_id, s.case_id
      into v_activity_shipment, v_shipment_case
    from public.customs_activities a
    left join public.shipments s
      on s.id = a.shipment_id and s.organization_id = a.organization_id
    where a.id = new.entity_id
      and a.organization_id = new.organization_id;

    if not found then
      raise exception using errcode = '23514', message = 'CUSTOMS_ACTIVITY_REMINDER_LINK_INVALID';
    end if;

    if v_activity_shipment is not null then
      if new.shipment_id is null then
        new.shipment_id := v_activity_shipment;
      elsif new.shipment_id is distinct from v_activity_shipment then
        raise exception using errcode = '23514', message = 'CUSTOMS_ACTIVITY_REMINDER_SHIPMENT_MISMATCH';
      end if;
      if new.case_id is null then
        new.case_id := v_shipment_case;
      elsif v_shipment_case is not null and new.case_id is distinct from v_shipment_case then
        raise exception using errcode = '23514', message = 'CUSTOMS_ACTIVITY_REMINDER_CASE_MISMATCH';
      end if;
    elsif new.shipment_id is not null then
      raise exception using errcode = '23514', message = 'CUSTOMS_ACTIVITY_REMINDER_SHIPMENT_MISMATCH';
    end if;
  end if;
  return new;
end;
$function$;

create trigger trg_validate_customs_activity_reminder_link
before insert or update of entity_type, entity_id, organization_id on public.operational_reminders
for each row execute function public.validate_customs_activity_reminder_link();

create or replace function public.log_customs_activity_reminder_link()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if tg_op = 'UPDATE'
     and old.entity_type = 'customs_activities'
     and (new.entity_type is distinct from old.entity_type or new.entity_id is distinct from old.entity_id) then
    perform public.append_customs_activity_event(
      old.organization_id, old.entity_id, 'reminder_unlinked',
      array['entity_type','entity_id'], to_jsonb(old.id),
      '{}'::jsonb, coalesce(new.created_by, auth.uid())
    );
  end if;

  if new.entity_type = 'customs_activities'
     and (tg_op = 'INSERT' or old.entity_type is distinct from new.entity_type or old.entity_id is distinct from new.entity_id) then
    perform public.append_customs_activity_event(
      new.organization_id, new.entity_id, 'reminder_linked',
      array['entity_type','entity_id'], '{}'::jsonb,
      jsonb_build_object('reminder_id', new.id), coalesce(new.created_by, auth.uid())
    );
  end if;
  return new;
end;
$function$;

revoke all on function public.validate_customs_activity_reminder_link() from public, anon, authenticated;
revoke all on function public.log_customs_activity_reminder_link() from public, anon, authenticated;

create trigger trg_log_customs_activity_reminder_link
after insert or update of entity_type, entity_id on public.operational_reminders
for each row execute function public.log_customs_activity_reminder_link();

revoke all on function public.reminder_entity_is_visible(uuid,text,uuid) from public, anon;
grant execute on function public.reminder_entity_is_visible(uuid,text,uuid) to authenticated;

commit;
