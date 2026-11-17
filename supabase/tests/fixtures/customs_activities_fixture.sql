-- Isolated PostgreSQL 15 fixture for the independent customs activity aggregate.
-- Run only against the dedicated customs_activity_test database in CI.

do $roles$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end
$roles$;
create schema if not exists auth;

create table auth.users (id uuid primary key);
create table public.organizations (id uuid primary key);
insert into public.organizations(id) values
 ('10000000-0000-0000-0000-000000000001'),
 ('10000000-0000-0000-0000-000000000002');

insert into auth.users(id) values
 ('20000000-0000-0000-0000-000000000001'),
 ('20000000-0000-0000-0000-000000000002'),
 ('20000000-0000-0000-0000-000000000003');

create table public.profiles (
  id uuid primary key references auth.users(id),
  organization_id uuid not null references public.organizations(id),
  role text not null,
  full_name text not null,
  is_active boolean not null default true,
  unique(id, organization_id)
);
insert into public.profiles(id,organization_id,role,full_name) values
 ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','broker','Broker A'),
 ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','broker','Broker B'),
 ('20000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','warehouse','Warehouse A');

create or replace function auth.uid()
returns uuid language sql stable
as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

create or replace function public.user_org_id()
returns uuid language sql stable
as $$ select nullif(current_setting('request.jwt.claim.org_id', true), '')::uuid $$;

create or replace function public.user_role()
returns text language sql stable
as $$ select nullif(current_setting('request.jwt.claim.role', true), '') $$;

create table public.shipments (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id),
  display_name text,
  unique(id, organization_id)
);
insert into public.shipments(id,organization_id,display_name) values
 ('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Shipment A'),
 ('30000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','Shipment B');

create table public.cases (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id),
  unique(id, organization_id)
);

create table public.customs_declarations (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id),
  shipment_id uuid,
  case_id uuid,
  unique(id, organization_id),
  foreign key (shipment_id, organization_id)
    references public.shipments(id, organization_id),
  foreign key (case_id, organization_id)
    references public.cases(id, organization_id)
);
insert into public.customs_declarations(id,organization_id,shipment_id) values
 ('40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001'),
 ('40000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000002');

create table public.file_assets (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id),
  original_name text not null,
  unique(id, organization_id)
);
insert into public.file_assets(id,organization_id,original_name) values
 ('50000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','declaration.pdf'),
 ('50000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','foreign.pdf');

create table public.file_manager_files (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id),
  file_asset_id uuid,
  shipment_id uuid,
  original_name text not null,
  document_type text not null default 'other'
);
insert into public.file_manager_files(id,organization_id,file_asset_id,shipment_id,original_name)
values (
  '51000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  '50000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001',
  'declaration.pdf'
);

create table public.finance_cost_items (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id),
  shipment_id uuid not null,
  description text not null,
  amount numeric not null default 0,
  currency text not null default 'IRR',
  workflow_status text not null default 'DRAFT',
  deleted_at timestamptz,
  created_by uuid,
  updated_by uuid,
  foreign key (shipment_id, organization_id)
    references public.shipments(id, organization_id)
);
insert into public.finance_cost_items(id,organization_id,shipment_id,description,amount,created_by) values
 ('60000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','Terminal cost',1000,'20000000-0000-0000-0000-000000000001');

create table public.operational_reminders (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id),
  title text not null,
  case_id uuid,
  shipment_id uuid,
  due_at timestamptz,
  status text not null default 'open',
  entity_type text,
  entity_id uuid,
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  constraint operational_reminders_entity_pair_check check (
    (entity_type is null and entity_id is null) or
    (entity_type is not null and entity_id is not null)
  ),
  constraint operational_reminders_entity_type_check check (
    entity_type is null or entity_type = any (
      array['customs_documents','shipment_documents','documents','shipments','cases','finance_invoices','clients']::text[]
    )
  )
);
create table public.customs_documents (id uuid primary key, organization_id uuid not null);
create table public.shipment_documents (id uuid primary key, organization_id uuid not null, shipment_id uuid);
create table public.documents (id uuid primary key, organization_id uuid not null);
create table public.finance_invoices (id uuid primary key, organization_id uuid not null);
create table public.clients (id uuid primary key, organization_id uuid not null);

alter table public.shipments enable row level security;
alter table public.customs_declarations enable row level security;
create policy shipments_select on public.shipments for select to authenticated
  using (organization_id = (select public.user_org_id()));
create policy declarations_select on public.customs_declarations for select to authenticated
  using (organization_id = (select public.user_org_id()));

grant usage on schema public to authenticated, anon;
grant usage on schema auth to authenticated, anon;
grant execute on function auth.uid() to authenticated, anon;
grant execute on function public.user_org_id() to authenticated, anon;
grant execute on function public.user_role() to authenticated, anon;
grant select on public.profiles, public.organizations, public.shipments,
  public.customs_declarations, public.file_assets, public.file_manager_files, public.finance_cost_items,
  public.operational_reminders to authenticated;
grant insert, update on public.finance_cost_items, public.operational_reminders to authenticated;
