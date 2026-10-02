-- Phase 2: explicit organization relationships and security
-- Live schema inspected 2026-10-02 before creation.
-- Does not alter existing domain tables.

create table if not exists public.org_connections (
  id uuid primary key default gen_random_uuid(),
  source_organization_id uuid not null references public.organizations(id),
  target_organization_id uuid not null references public.organizations(id),
  relationship_type text not null check (relationship_type in ('customer','partner','transport','other')),
  status text not null default 'pending' check (status in ('pending','accepted','suspended','cancelled')),
  requested_by uuid not null references public.profiles(id),
  accepted_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists org_connections_source_idx
  on public.org_connections(source_organization_id, status, updated_at desc);
create index if not exists org_connections_target_idx
  on public.org_connections(target_organization_id, status, updated_at desc);
create index if not exists org_connections_requested_by_idx
  on public.org_connections(requested_by, status);
create index if not exists org_connections_accepted_by_idx
  on public.org_connections(accepted_by);

create unique index if not exists org_connections_active_pair_idx
  on public.org_connections(least(source_organization_id, target_organization_id),
                            greatest(source_organization_id, target_organization_id))
  where deleted_at is null and status in ('pending','accepted','suspended');

create or replace function public.user_is_org_manager(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog, pg_temp
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.organization_id = p_organization_id
      and p.is_active = true
      and p.role in ('owner','admin')
  );
$$;

create or replace function public.is_org_member(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog, pg_temp
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.organization_id = p_organization_id
      and p.is_active = true
  );
$$;

create or replace function public.orgs_are_connected(p_left uuid, p_right uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog, pg_temp
as $$
  select
    p_left is not null
    and p_right is not null
    and p_left <> p_right
    and exists (
      select 1
      from public.org_connections c
      where (
        (c.source_organization_id = p_left and c.target_organization_id = p_right)
        or
        (c.source_organization_id = p_right and c.target_organization_id = p_left)
      )
      and c.status = 'accepted'
      and c.deleted_at is null
    );
$$;

revoke all on function public.user_is_org_manager(uuid) from public, anon;
revoke all on function public.is_org_member(uuid) from public, anon;
revoke all on function public.orgs_are_connected(uuid,uuid) from public, anon;
grant execute on function public.user_is_org_manager(uuid) to authenticated;
grant execute on function public.is_org_member(uuid) to authenticated;
grant execute on function public.orgs_are_connected(uuid,uuid) to authenticated;

create or replace function public.touch_org_connections_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_catalog, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.guard_org_connection_transition()
returns trigger
security definer
language plpgsql
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_org uuid;
  v_role text;
begin
  if auth.uid() is null then
    raise exception 'Authenticated user required';
  end if;

  select p.organization_id, p.role::text
    into v_org, v_role
  from public.profiles p
  where p.id = auth.uid() and p.is_active = true;

  if v_org is null then
    raise exception 'Active profile required';
  end if;

  if tg_op = 'INSERT' then
    if new.source_organization_id <> v_org then
      raise exception 'Connection requests must originate from the authenticated user organization';
    end if;
    if new.source_organization_id = new.target_organization_id then
      raise exception 'An organization cannot connect to itself';
    end if;
    if v_role = 'client' then
      raise exception 'Client role cannot create organization connections';
    end if;
    if new.status <> 'pending' then
      raise exception 'New organization connections must start as pending';
    end if;
    new.requested_by = auth.uid();
  elsif tg_op = 'UPDATE' then
    if new.source_organization_id <> old.source_organization_id
       or new.target_organization_id <> old.target_organization_id then
      raise exception 'Organization endpoints are immutable';
    end if;

    if new.status is distinct from old.status then
      if new.status = 'accepted' then
        if old.status <> 'pending'
           or v_org <> old.target_organization_id
           or v_role not in ('owner','admin') then
          raise exception 'Only a target organization manager can accept a pending connection';
        end if;
        new.accepted_by = auth.uid();
        new.deleted_at = null;
      elsif new.status = 'suspended' then
        if old.status <> 'accepted'
           or v_org not in (old.source_organization_id, old.target_organization_id)
           or v_role not in ('owner','admin') then
          raise exception 'Only an organization manager can suspend an accepted connection';
        end if;
      elsif new.status = 'cancelled' then
        if v_org not in (old.source_organization_id, old.target_organization_id)
           or v_role not in ('owner','admin') then
          raise exception 'Only an organization manager can cancel a connection';
        end if;
        new.deleted_at = coalesce(new.deleted_at, now());
      else
        raise exception 'Unsupported organization connection transition';
      end if;
    elsif new.deleted_at is distinct from old.deleted_at then
      if v_org not in (old.source_organization_id, old.target_organization_id)
         or v_role not in ('owner','admin') then
        raise exception 'Only an organization manager can change connection deletion state';
      end if;
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.guard_org_connection_transition() from public, anon;

create or replace function public.record_org_connection_audit()
returns trigger
security definer
language plpgsql
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_org uuid;
  v_record uuid;
  v_old jsonb;
  v_new jsonb;
begin
  if tg_op = 'DELETE' then
    v_org := old.source_organization_id;
    v_record := old.id;
    v_old := to_jsonb(old);
  elsif tg_op = 'UPDATE' then
    v_org := new.source_organization_id;
    v_record := new.id;
    v_old := to_jsonb(old);
    v_new := to_jsonb(new);
  else
    v_org := new.source_organization_id;
    v_record := new.id;
    v_new := to_jsonb(new);
  end if;

  insert into public.audit_logs (
    organization_id, user_id, action, table_name, record_id, old_data, new_data
  )
  values (
    v_org, auth.uid(), tg_op, tg_table_name, v_record, v_old, v_new
  );

  return coalesce(new, old);
end;
$$;

revoke all on function public.record_org_connection_audit() from public, anon;

alter table public.org_connections enable row level security;

drop policy if exists org_connections_select on public.org_connections;
create policy org_connections_select
on public.org_connections
for select
to authenticated
using (
  public.is_org_member(source_organization_id)
  or public.is_org_member(target_organization_id)
);

drop policy if exists org_connections_insert on public.org_connections;
create policy org_connections_insert
on public.org_connections
for insert
to authenticated
with check (
  public.is_org_member(source_organization_id)
  and public.user_is_org_manager(source_organization_id)
  and source_organization_id = (select public.user_org_id())
  and target_organization_id <> source_organization_id
  and status = 'pending'
);

drop policy if exists org_connections_update on public.org_connections;
create policy org_connections_update
on public.org_connections
for update
to authenticated
using (
  public.is_org_member(source_organization_id)
  or public.is_org_member(target_organization_id)
)
with check (
  public.is_org_member(source_organization_id)
  or public.is_org_member(target_organization_id)
);

drop policy if exists org_connections_delete on public.org_connections;
create policy org_connections_delete
on public.org_connections
for delete
to authenticated
using (false);

grant select, insert, update on public.org_connections to authenticated;
revoke all on public.org_connections from anon;

drop trigger if exists trg_org_connections_guest_guard on public.org_connections;
create trigger trg_org_connections_guest_guard
before insert or update or delete on public.org_connections
for each row execute function public.block_audit_guest_writes();

drop trigger if exists trg_org_connections_transition_guard on public.org_connections;
create trigger trg_org_connections_transition_guard
before insert or update on public.org_connections
for each row execute function public.guard_org_connection_transition();

drop trigger if exists trg_org_connections_updated_at on public.org_connections;
create trigger trg_org_connections_updated_at
before update on public.org_connections
for each row execute function public.touch_org_connections_updated_at();

drop trigger if exists trg_org_connections_audit on public.org_connections;
create trigger trg_org_connections_audit
after insert or update or delete on public.org_connections
for each row execute function public.record_org_connection_audit();

comment on table public.org_connections is 'Explicit cross-organization relationship gate; accepted is the only state that authorizes cross-org collaboration.';
