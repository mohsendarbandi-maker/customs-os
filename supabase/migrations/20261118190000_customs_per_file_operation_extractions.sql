-- Per-file naming and AI extraction scoped to each customs operation box.
alter table public.shipment_documents
  add column if not exists operation_sections text[] not null default '{}';

alter table public.file_manager_files
  add column if not exists operation_sections text[] not null default '{}';

alter table public.shipment_documents
  drop constraint if exists shipment_documents_operation_sections_check;
alter table public.shipment_documents
  add constraint shipment_documents_operation_sections_check
  check (operation_sections <@ array['evaluation','expertise','cashier','loading_permit','exit','port_charges']::text[]);

alter table public.file_manager_files
  drop constraint if exists file_manager_files_operation_sections_check;
alter table public.file_manager_files
  add constraint file_manager_files_operation_sections_check
  check (operation_sections <@ array['evaluation','expertise','cashier','loading_permit','exit','port_charges']::text[]);

create index if not exists shipment_documents_operation_sections_gin
  on public.shipment_documents using gin(operation_sections);
create index if not exists file_manager_files_operation_sections_gin
  on public.file_manager_files using gin(operation_sections);

create table if not exists public.customs_document_extractions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  declaration_id uuid not null references public.customs_declarations(id) on delete cascade,
  shipment_id uuid references public.shipments(id) on delete set null,
  shipment_document_id uuid references public.shipment_documents(id) on delete cascade,
  file_manager_file_id uuid references public.file_manager_files(id) on delete cascade,
  customs_document_id uuid references public.customs_documents(id) on delete cascade,
  file_asset_id uuid references public.file_assets(id) on delete set null,
  source_key text not null,
  operation_section text not null check (operation_section = any(array['evaluation','expertise','cashier','loading_permit','exit','port_charges']::text[])),
  document_type text,
  display_name text,
  original_file_name text,
  status text not null default 'pending' check (status = any(array['pending','processing','completed','failed']::text[])),
  extracted_fields jsonb,
  confidence jsonb,
  provider text,
  model text,
  error text,
  extracted_by uuid references auth.users(id) on delete set null,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint customs_document_extractions_has_source
    check (num_nonnulls(shipment_document_id,file_manager_file_id,customs_document_id,file_asset_id) > 0),
  constraint customs_document_extractions_source_section_key
    unique (declaration_id,source_key,operation_section)
);

create index if not exists customs_document_extractions_declaration_section_idx
  on public.customs_document_extractions(organization_id,declaration_id,operation_section,updated_at desc);
create index if not exists customs_document_extractions_file_idx
  on public.customs_document_extractions(file_asset_id)
  where file_asset_id is not null;

alter table public.customs_document_extractions enable row level security;

drop policy if exists customs_document_extractions_select on public.customs_document_extractions;
create policy customs_document_extractions_select
  on public.customs_document_extractions for select to authenticated
  using (
    organization_id = user_org_id()
    and user_role() = any(array['owner','admin','broker','warehouse','accountant']::user_role[])
  );

drop policy if exists customs_document_extractions_insert on public.customs_document_extractions;
create policy customs_document_extractions_insert
  on public.customs_document_extractions for insert to authenticated
  with check (
    organization_id = user_org_id()
    and user_role() = any(array['owner','admin','broker','warehouse','accountant']::user_role[])
  );

drop policy if exists customs_document_extractions_update on public.customs_document_extractions;
create policy customs_document_extractions_update
  on public.customs_document_extractions for update to authenticated
  using (
    organization_id = user_org_id()
    and user_role() = any(array['owner','admin','broker','warehouse','accountant']::user_role[])
  )
  with check (
    organization_id = user_org_id()
    and user_role() = any(array['owner','admin','broker','warehouse','accountant']::user_role[])
  );

create or replace function public.touch_customs_document_extractions_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists customs_document_extractions_updated_at on public.customs_document_extractions;
create trigger customs_document_extractions_updated_at
before update on public.customs_document_extractions
for each row execute function public.touch_customs_document_extractions_updated_at();

grant select,insert,update on public.customs_document_extractions to authenticated;
