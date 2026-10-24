-- Logical customs document folders and Telegram-backed file-manager metadata.
-- The original bytes are archived through the existing messenger-gateway;
-- this migration does not create a second binary storage service.

create table if not exists public.file_manager_folders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  parent_id uuid null,
  folder_key text not null,
  folder_type text not null check (folder_type in (
    'root', 'client', 'shipment', 'accounting_finance', 'shipping_docs',
    'purchase_docs', 'warehouse_receipt', 'declaration', 'permits',
    'exit', 'other', 'custom'
  )),
  display_name text not null,
  client_id uuid null references public.clients(id) on delete set null,
  shipment_id uuid null references public.shipments(id) on delete cascade,
  customs_office_id uuid null references public.customs_offices(id) on delete set null,
  is_system boolean not null default false,
  created_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint file_manager_folders_id_org_unique unique (id, organization_id),
  constraint file_manager_folders_parent_same_org_fk
    foreign key (parent_id, organization_id)
    references public.file_manager_folders(id, organization_id) on delete cascade
);

create unique index if not exists file_manager_folders_root_key_uq
  on public.file_manager_folders (organization_id, folder_key)
  where parent_id is null;

create unique index if not exists file_manager_folders_child_key_uq
  on public.file_manager_folders (organization_id, parent_id, folder_key)
  where parent_id is not null;

-- Let existing document workflows reference Telegram bytes without copying them to Supabase Storage.
alter table public.shipment_documents
  add column if not exists storage_backend text not null default 'supabase',
  add column if not exists file_asset_id uuid null references public.file_assets(id) on delete set null,
  add column if not exists folder_id uuid null references public.file_manager_folders(id) on delete set null,
  add column if not exists telegram_message_id text null;

alter table public.customs_documents
  add column if not exists storage_backend text not null default 'supabase',
  add column if not exists file_asset_id uuid null references public.file_assets(id) on delete set null,
  add column if not exists folder_id uuid null references public.file_manager_folders(id) on delete set null,
  add column if not exists telegram_message_id text null;

alter table public.shipment_documents
  drop constraint if exists shipment_documents_extraction_status_check;

alter table public.shipment_documents
  add constraint shipment_documents_extraction_status_check
  check (extraction_status in ('pending','processing','completed','failed','not_requested'));

alter table public.shipment_documents
  drop constraint if exists shipment_documents_storage_backend_check;

alter table public.shipment_documents
  add constraint shipment_documents_storage_backend_check
  check (storage_backend in ('supabase','telegram'));

alter table public.customs_documents
  drop constraint if exists customs_documents_storage_backend_check;

alter table public.customs_documents
  add constraint customs_documents_storage_backend_check
  check (storage_backend in ('supabase','telegram'));

create index if not exists shipment_documents_file_asset_idx
  on public.shipment_documents (organization_id, file_asset_id)
  where file_asset_id is not null;

create index if not exists customs_documents_file_asset_idx
  on public.customs_documents (organization_id, file_asset_id)
  where file_asset_id is not null;

create index if not exists file_manager_folders_org_parent_idx
  on public.file_manager_folders (organization_id, parent_id, display_name);

create index if not exists file_manager_folders_org_shipment_idx
  on public.file_manager_folders (organization_id, shipment_id)
  where shipment_id is not null;

create table if not exists public.file_manager_files (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  folder_id uuid not null,
  shipment_id uuid not null,
  file_asset_id uuid null references public.file_assets(id) on delete restrict,
  original_name text not null,
  mime_type text not null default 'application/octet-stream',
  size_bytes bigint not null default 0 check (size_bytes >= 0),
  external_message_id text null,
  document_type text not null default 'other',
  tags text[] not null default '{}'::text[],
  metadata jsonb not null default '{}'::jsonb,
  -- Optional compatibility pointer to the pre-existing Storage-backed document row.
  shipment_document_id uuid null references public.shipment_documents(id) on delete set null,
  customs_document_id uuid null references public.customs_documents(id) on delete set null,
  storage_path text null,
  created_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint file_manager_files_folder_same_org_fk
    foreign key (folder_id, organization_id)
    references public.file_manager_folders(id, organization_id) on delete restrict,
  constraint file_manager_files_shipment_same_org_fk
    foreign key (shipment_id, organization_id)
    references public.shipments(id, organization_id) on delete cascade,
  constraint file_manager_files_asset_unique unique (organization_id, file_asset_id),
  constraint file_manager_files_has_source_check check (
    file_asset_id is not null or shipment_document_id is not null or customs_document_id is not null
  )
);

create index if not exists file_manager_files_folder_created_idx
  on public.file_manager_files (organization_id, folder_id, created_at desc);

create index if not exists file_manager_files_shipment_idx
  on public.file_manager_files (organization_id, shipment_id);

create unique index if not exists file_manager_files_shipment_doc_uq
  on public.file_manager_files (organization_id, shipment_document_id)
  where shipment_document_id is not null;

create unique index if not exists file_manager_files_customs_doc_uq
  on public.file_manager_files (organization_id, customs_document_id)
  where customs_document_id is not null;

create index if not exists file_manager_files_tags_gin_idx
  on public.file_manager_files using gin (tags);

-- Existing pg_trgm is installed in the extensions schema; these indexes accelerate
-- the most common substring searches without fetching full tables into the browser.
create index if not exists file_manager_folders_display_name_trgm_idx
  on public.file_manager_folders using gin (display_name extensions.gin_trgm_ops);

create index if not exists file_manager_files_original_name_trgm_idx
  on public.file_manager_files using gin (original_name extensions.gin_trgm_ops);

create index if not exists clients_name_trgm_idx
  on public.clients using gin (name extensions.gin_trgm_ops);

create index if not exists shipments_display_name_trgm_idx
  on public.shipments using gin (display_name extensions.gin_trgm_ops);

create index if not exists shipments_bill_of_lading_no_trgm_idx
  on public.shipments using gin (bill_of_lading_no extensions.gin_trgm_ops);

create index if not exists vessels_name_trgm_idx
  on public.vessels using gin (name extensions.gin_trgm_ops);

create index if not exists customs_declarations_kottaj_number_trgm_idx
  on public.customs_declarations using gin (kottaj_number extensions.gin_trgm_ops);

create index if not exists shipment_documents_original_name_trgm_idx
  on public.shipment_documents using gin (original_file_name extensions.gin_trgm_ops);

create index if not exists customs_documents_original_name_trgm_idx
  on public.customs_documents using gin (original_name extensions.gin_trgm_ops);

create index if not exists customs_documents_display_name_trgm_idx
  on public.customs_documents using gin (display_name extensions.gin_trgm_ops);

alter table public.file_manager_folders enable row level security;
alter table public.file_manager_files enable row level security;
grant select, insert, update, delete on public.file_manager_folders to authenticated;
grant select on public.file_manager_files to authenticated;

drop policy if exists file_manager_folders_select on public.file_manager_folders;
create policy file_manager_folders_select on public.file_manager_folders
  for select to authenticated
  using (
    organization_id = public.user_org_id()
    and (
      public.user_role()::text <> 'client'
      or folder_type = 'root'
      or client_id = public.user_client_id()
    )
  );

drop policy if exists file_manager_folders_insert on public.file_manager_folders;
create policy file_manager_folders_insert on public.file_manager_folders
  for insert to authenticated
  with check (
    organization_id = public.user_org_id()
    and public.user_role()::text in ('owner', 'admin', 'broker', 'accountant', 'warehouse')
  );

drop policy if exists file_manager_folders_insert_client_custom on public.file_manager_folders;
create policy file_manager_folders_insert_client_custom on public.file_manager_folders
  for insert to authenticated
  with check (
    organization_id = public.user_org_id()
    and public.user_role()::text = 'client'
    and folder_type = 'custom'
    and is_system = false
    and client_id = public.user_client_id()
    and shipment_id is not null
    and parent_id is not null
    and exists (
      select 1
      from public.file_manager_folders parent
      where parent.id = file_manager_folders.parent_id
        and parent.organization_id = file_manager_folders.organization_id
        and parent.shipment_id = file_manager_folders.shipment_id
        and parent.client_id = public.user_client_id()
    )
  );

drop policy if exists file_manager_folders_update on public.file_manager_folders;
create policy file_manager_folders_update on public.file_manager_folders
  for update to authenticated
  using (
    organization_id = public.user_org_id()
    and public.user_role()::text in ('owner', 'admin', 'broker', 'accountant', 'warehouse')
  )
  with check (
    organization_id = public.user_org_id()
    and public.user_role()::text in ('owner', 'admin', 'broker', 'accountant', 'warehouse')
  );

drop policy if exists file_manager_folders_delete on public.file_manager_folders;
create policy file_manager_folders_delete on public.file_manager_folders
  for delete to authenticated
  using (
    organization_id = public.user_org_id()
    and public.user_role()::text in ('owner', 'admin')
    and is_system = false
  );

drop policy if exists file_manager_files_select on public.file_manager_files;
create policy file_manager_files_select on public.file_manager_files
  for select to authenticated
  using (
    organization_id = public.user_org_id()
    and (
      public.user_role()::text <> 'client'
      or exists (
        select 1
        from public.file_manager_folders f
        where f.id = file_manager_files.folder_id
          and f.organization_id = file_manager_files.organization_id
          and (f.folder_type = 'root' or f.client_id = public.user_client_id())
      )
    )
  );

drop policy if exists file_manager_files_update on public.file_manager_files;
create policy file_manager_files_update on public.file_manager_files
  for update to authenticated
  using (
    organization_id = public.user_org_id()
    and public.user_role()::text in ('owner', 'admin', 'broker', 'accountant', 'warehouse')
  )
  with check (
    organization_id = public.user_org_id()
    and public.user_role()::text in ('owner', 'admin', 'broker', 'accountant', 'warehouse')
  );

-- Service-role gateway inserts file records after Telegram confirms the message.
-- Validate that each association stays inside its shipment's logical folder.
create or replace function public.validate_file_manager_file_folder()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_folder_shipment uuid;
  v_folder_org uuid;
begin
  select f.shipment_id, f.organization_id
    into v_folder_shipment, v_folder_org
  from public.file_manager_folders f
  where f.id = new.folder_id;

  if v_folder_org is distinct from new.organization_id
     or v_folder_shipment is distinct from new.shipment_id then
    raise exception 'FILE_MANAGER_FOLDER_SHIPMENT_MISMATCH';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_validate_file_manager_file_folder on public.file_manager_files;
create trigger trg_validate_file_manager_file_folder
before insert or update of folder_id, shipment_id, organization_id
on public.file_manager_files
for each row execute function public.validate_file_manager_file_folder();

create or replace function public.ensure_shipment_file_manager_folders(p_shipment_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_client uuid;
  v_shipment uuid;
  v_client_name text;
  v_shipment_name text;
  v_office_id uuid;
  v_office_name text;
  v_root_id uuid;
  v_client_folder_id uuid;
  v_shipment_folder_id uuid;
  v_child record;
begin
  select s.organization_id, s.client_id, s.id,
         coalesce(nullif(trim(c.name), ''), 'صاحب کالا'),
         coalesce(nullif(trim(s.display_name), ''), 'محموله ' || left(s.id::text, 8)),
         coalesce(s.customs_office_id, ca.customs_office_id, scd.customs_office_id),
         coalesce(nullif(trim(o.name), ''), nullif(trim(o.code), ''), 'گمرک نامشخص')
  into v_org, v_client, v_shipment, v_client_name, v_shipment_name, v_office_id, v_office_name
  from public.shipments s
  left join public.clients c
    on c.id = s.client_id and c.organization_id = s.organization_id
  left join public.cases ca
    on ca.id = s.case_id and ca.organization_id = s.organization_id
  left join public.shipment_customs_data scd
    on scd.shipment_id = s.id and scd.organization_id = s.organization_id
  left join public.customs_offices o
    on o.id = coalesce(s.customs_office_id, ca.customs_office_id, scd.customs_office_id)
  where s.id = p_shipment_id;

  if v_org is null or v_client is null or v_shipment is null then
    return;
  end if;

  insert into public.file_manager_folders
    (organization_id, parent_id, folder_key, folder_type, display_name, is_system)
  values
    (v_org, null, 'owners-root', 'root', 'صاحبان کالا', true)
  on conflict do nothing;

  select f.id into v_root_id
  from public.file_manager_folders f
  where f.organization_id = v_org and f.parent_id is null and f.folder_key = 'owners-root'
  limit 1;

  if v_root_id is null then
    raise exception 'FILE_MANAGER_ROOT_FOLDER_CREATE_FAILED';
  end if;

  insert into public.file_manager_folders
    (organization_id, parent_id, folder_key, folder_type, display_name, client_id, is_system)
  values
    (v_org, v_root_id, 'client:' || v_client::text, 'client', v_client_name, v_client, true)
  on conflict do nothing;

  select f.id into v_client_folder_id
  from public.file_manager_folders f
  where f.organization_id = v_org and f.parent_id = v_root_id
    and f.folder_key = 'client:' || v_client::text
  limit 1;

  if v_client_folder_id is null then
    raise exception 'FILE_MANAGER_CLIENT_FOLDER_CREATE_FAILED';
  end if;

  -- Update a shipment folder in place if its owner changed, rather than copying its files.
  select f.id into v_shipment_folder_id
  from public.file_manager_folders f
  where f.organization_id = v_org and f.folder_type = 'shipment'
    and f.shipment_id = v_shipment
  order by f.created_at
  limit 1;

  if v_shipment_folder_id is null then
    insert into public.file_manager_folders
      (organization_id, parent_id, folder_key, folder_type, display_name,
       client_id, shipment_id, customs_office_id, is_system)
    values
      (v_org, v_client_folder_id, 'shipment:' || v_shipment::text, 'shipment',
       v_shipment_name || ' - ' || v_office_name || ' - ' || left(v_shipment::text, 8),
       v_client, v_shipment, v_office_id, true)
    on conflict do nothing;

    select f.id into v_shipment_folder_id
    from public.file_manager_folders f
    where f.organization_id = v_org and f.folder_type = 'shipment'
      and f.shipment_id = v_shipment
    order by f.created_at
    limit 1;
  end if;

  if v_shipment_folder_id is null then
    raise exception 'FILE_MANAGER_SHIPMENT_FOLDER_CREATE_FAILED';
  end if;

  update public.file_manager_folders
  set parent_id = v_client_folder_id,
      folder_key = 'shipment:' || v_shipment::text,
      display_name = v_shipment_name || ' - ' || v_office_name || ' - ' || left(v_shipment::text, 8),
      client_id = v_client,
      shipment_id = v_shipment,
      customs_office_id = v_office_id,
      updated_at = now()
  where id = v_shipment_folder_id and organization_id = v_org;

  for v_child in
    select *
    from (values
      ('accounting-finance', 'accounting_finance', 'حسابداری مالی'),
      ('shipping-docs', 'shipping_docs', 'اسناد حمل'),
      ('purchase-docs', 'purchase_docs', 'پیش‌فاکتور و ثبت سفارش'),
      ('warehouse-receipt', 'warehouse_receipt', 'قبض انبار'),
      ('declaration', 'declaration', 'اسناد اظهارنامه و کوتاژ'),
      ('permits-inspection', 'permits', 'مجوزها و بازرسی'),
      ('exit', 'exit', 'ترخیص و درب خروج'),
      ('other', 'other', 'سایر اسناد')
    ) as defaults(folder_key, folder_type, display_name)
  loop
    insert into public.file_manager_folders
      (organization_id, parent_id, folder_key, folder_type, display_name,
       client_id, shipment_id, customs_office_id, is_system)
    values
      (v_org, v_shipment_folder_id, v_child.folder_key, v_child.folder_type,
       v_child.display_name, v_client, v_shipment, v_office_id, true)
    on conflict do nothing;

    update public.file_manager_folders
    set display_name = v_child.display_name,
        client_id = v_client,
        shipment_id = v_shipment,
        customs_office_id = v_office_id,
        updated_at = now()
    where organization_id = v_org and parent_id = v_shipment_folder_id
      and folder_key = v_child.folder_key;
  end loop;
end;
$$;

revoke all on function public.ensure_shipment_file_manager_folders(uuid) from public, anon, authenticated;

create or replace function public.trigger_ensure_shipment_file_manager_folders()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.ensure_shipment_file_manager_folders(new.id);
  return new;
end;
$$;

revoke all on function public.trigger_ensure_shipment_file_manager_folders() from public, anon, authenticated;

drop trigger if exists trg_ensure_shipment_file_manager_folders on public.shipments;
create trigger trg_ensure_shipment_file_manager_folders
after insert or update of client_id, case_id, customs_office_id, display_name
on public.shipments
for each row
when (new.client_id is not null)
execute function public.trigger_ensure_shipment_file_manager_folders();

create or replace function public.sync_file_manager_client_folder_name()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.file_manager_folders
  set display_name = coalesce(nullif(trim(new.name), ''), 'صاحب کالا'),
      updated_at = now()
  where organization_id = new.organization_id and client_id = new.id and folder_type = 'client';
  return new;
end;
$$;

revoke all on function public.sync_file_manager_client_folder_name() from public, anon, authenticated;

drop trigger if exists trg_sync_file_manager_client_folder_name on public.clients;
create trigger trg_sync_file_manager_client_folder_name
after update of name on public.clients
for each row
when (new.name is distinct from old.name)
execute function public.sync_file_manager_client_folder_name();

create or replace function public.sync_file_manager_customs_office_name()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_shipment record;
begin
  for v_shipment in
    select s.id
    from public.shipments s
    left join public.cases ca on ca.id = s.case_id and ca.organization_id = s.organization_id
    where coalesce(s.customs_office_id, ca.customs_office_id) = new.id
      and s.organization_id = coalesce(new.organization_id, s.organization_id)
      and s.client_id is not null
  loop
    perform public.ensure_shipment_file_manager_folders(v_shipment.id);
  end loop;
  return new;
end;
$$;

revoke all on function public.sync_file_manager_customs_office_name() from public, anon, authenticated;

drop trigger if exists trg_sync_file_manager_customs_office_name on public.customs_offices;
create trigger trg_sync_file_manager_customs_office_name
after update of name, code on public.customs_offices
for each row
execute function public.sync_file_manager_customs_office_name();

-- Maintain indexed metadata-only search text. This flattens database columns, never file bytes.
create or replace function public.set_file_manager_search_text()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.file_manager_search_text := (to_jsonb(new) - 'file_manager_search_text')::text;
  return new;
end;
$;

revoke all on function public.set_file_manager_search_text() from public, anon, authenticated;

alter table public.file_manager_folders add column if not exists file_manager_search_text text not null default '';
alter table public.file_manager_files add column if not exists file_manager_search_text text not null default '';
alter table public.shipments add column if not exists file_manager_search_text text not null default '';
alter table public.clients add column if not exists file_manager_search_text text not null default '';
alter table public.vessels add column if not exists file_manager_search_text text not null default '';
alter table public.cases add column if not exists file_manager_search_text text not null default '';
alter table public.customs_offices add column if not exists file_manager_search_text text not null default '';
alter table public.shipping_lines add column if not exists file_manager_search_text text not null default '';
alter table public.shipment_customs_data add column if not exists file_manager_search_text text not null default '';
alter table public.customs_declarations add column if not exists file_manager_search_text text not null default '';
alter table public.shipment_documents add column if not exists file_manager_search_text text not null default '';
alter table public.customs_documents add column if not exists file_manager_search_text text not null default '';

do $
declare t text;
begin
  foreach t in array array[
    'file_manager_folders','file_manager_files','shipments','clients','vessels','cases',
    'customs_offices','shipping_lines','shipment_customs_data','customs_declarations',
    'shipment_documents','customs_documents'
  ] loop
    execute format('drop trigger if exists trg_file_manager_search_text on public.%I', t);
    execute format('create trigger trg_file_manager_search_text before insert or update on public.%I for each row execute function public.set_file_manager_search_text()', t);
  end loop;
end $;

create index if not exists file_manager_folders_search_text_trgm_idx on public.file_manager_folders using gin (file_manager_search_text extensions.gin_trgm_ops);
create index if not exists file_manager_files_search_text_trgm_idx on public.file_manager_files using gin (file_manager_search_text extensions.gin_trgm_ops);
create index if not exists shipments_search_text_trgm_idx on public.shipments using gin (file_manager_search_text extensions.gin_trgm_ops);
create index if not exists clients_search_text_trgm_idx on public.clients using gin (file_manager_search_text extensions.gin_trgm_ops);
create index if not exists vessels_search_text_trgm_idx on public.vessels using gin (file_manager_search_text extensions.gin_trgm_ops);
create index if not exists cases_search_text_trgm_idx on public.cases using gin (file_manager_search_text extensions.gin_trgm_ops);
create index if not exists customs_offices_search_text_trgm_idx on public.customs_offices using gin (file_manager_search_text extensions.gin_trgm_ops);
create index if not exists shipping_lines_search_text_trgm_idx on public.shipping_lines using gin (file_manager_search_text extensions.gin_trgm_ops);
create index if not exists shipment_customs_data_search_text_trgm_idx on public.shipment_customs_data using gin (file_manager_search_text extensions.gin_trgm_ops);
create index if not exists customs_declarations_search_text_trgm_idx on public.customs_declarations using gin (file_manager_search_text extensions.gin_trgm_ops);
create index if not exists shipment_documents_search_text_trgm_idx on public.shipment_documents using gin (file_manager_search_text extensions.gin_trgm_ops);
create index if not exists customs_documents_search_text_trgm_idx on public.customs_documents using gin (file_manager_search_text extensions.gin_trgm_ops);

-- Populate existing metadata once. Subsequent writes are maintained by the trigger.
update public.file_manager_folders set file_manager_search_text = file_manager_search_text;
update public.file_manager_files set file_manager_search_text = file_manager_search_text;
update public.shipments set file_manager_search_text = file_manager_search_text;
update public.clients set file_manager_search_text = file_manager_search_text;
update public.vessels set file_manager_search_text = file_manager_search_text;
update public.cases set file_manager_search_text = file_manager_search_text;
update public.customs_offices set file_manager_search_text = file_manager_search_text;
update public.shipping_lines set file_manager_search_text = file_manager_search_text;
update public.shipment_customs_data set file_manager_search_text = file_manager_search_text;
update public.customs_declarations set file_manager_search_text = file_manager_search_text;
update public.shipment_documents set file_manager_search_text = file_manager_search_text;
update public.customs_documents set file_manager_search_text = file_manager_search_text;

-- Backfill only the logical tree for existing shipments. No existing file bytes or rows move.
select public.ensure_shipment_file_manager_folders(s.id)
from public.shipments s
where s.client_id is not null;


-- Preserve visibility of existing Storage-backed documents under the new logical tree.
-- These rows reference existing bytes; they do not copy or delete any file.
insert into public.file_manager_files
  (organization_id,folder_id,shipment_id,client_id,file_asset_id,original_name,mime_type,size_bytes,
   document_type,tags,metadata,shipment_document_id,storage_path,created_by)
select sd.organization_id,f.id,sd.shipment_id,s.client_id,sd.file_asset_id,
       sd.original_file_name,coalesce(sd.mime_type,'application/octet-stream'),
       greatest(coalesce(sd.file_size_bytes,0),0),'other','{}'::text[],
       jsonb_build_object('legacyStorageBackend',coalesce(sd.storage_backend,'supabase')),
       sd.id,sd.storage_path,sd.uploaded_by
from public.shipment_documents sd
join public.shipments s on s.id=sd.shipment_id and s.organization_id=sd.organization_id
join public.file_manager_folders f on f.organization_id=sd.organization_id
  and f.shipment_id=sd.shipment_id and f.folder_type='other'
where not coalesce(sd.is_archived,false)
  and not exists (select 1 from public.file_manager_files fm
    where fm.organization_id=sd.organization_id and fm.shipment_document_id=sd.id)
on conflict do nothing;

insert into public.file_manager_files
  (organization_id,folder_id,shipment_id,client_id,file_asset_id,original_name,mime_type,size_bytes,
   document_type,tags,metadata,customs_document_id,storage_path,created_by)
select cd.organization_id,f.id,cd.shipment_id,coalesce(cd.client_id,s.client_id),cd.file_asset_id,
       coalesce(cd.display_name,cd.original_name),coalesce(cd.mime_type,'application/octet-stream'),
       greatest(coalesce(cd.size_bytes,0),0),coalesce(cd.document_type::text,'other'),
       coalesce(cd.tags,'{}'::text[]),
       jsonb_build_object('legacyStorageBackend',coalesce(cd.storage_backend,'supabase')),
       cd.id,cd.storage_path,cd.created_by
from public.customs_documents cd
join public.shipments s on s.id=cd.shipment_id and s.organization_id=cd.organization_id
join public.file_manager_folders f on f.organization_id=cd.organization_id
  and f.shipment_id=cd.shipment_id and f.folder_type='other'
where not coalesce(cd.is_archived,false)
  and not exists (select 1 from public.shipment_documents sd
    where sd.id=cd.id and sd.organization_id=cd.organization_id)
  and not exists (select 1 from public.file_manager_files fm
    where fm.organization_id=cd.organization_id and fm.customs_document_id=cd.id)
on conflict do nothing;

-- Future legacy uploads also become visible in the logical tree without copying bytes.
create or replace function public.sync_shipment_document_to_file_manager()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_client uuid;
  v_folder uuid;
begin
  select s.client_id into v_client
  from public.shipments s
  where s.id=new.shipment_id and s.organization_id=new.organization_id;
  select f.id into v_folder
  from public.file_manager_folders f
  where f.organization_id=new.organization_id and f.shipment_id=new.shipment_id
    and f.folder_type='other'
  limit 1;
  if v_folder is not null then
    insert into public.file_manager_files
      (organization_id,folder_id,shipment_id,client_id,file_asset_id,original_name,mime_type,size_bytes,
       document_type,tags,metadata,shipment_document_id,storage_path,created_by)
    values
      (new.organization_id,v_folder,new.shipment_id,v_client,new.file_asset_id,
       new.original_file_name,coalesce(new.mime_type,'application/octet-stream'),
       greatest(coalesce(new.file_size_bytes,0),0),'other','{}'::text[],
       jsonb_build_object('legacyStorageBackend',coalesce(new.storage_backend,'supabase')),
       new.id,new.storage_path,new.uploaded_by)
    on conflict do nothing;
  end if;
  return new;
end;
$;

revoke all on function public.sync_shipment_document_to_file_manager() from public, anon, authenticated;
drop trigger if exists trg_sync_shipment_document_to_file_manager on public.shipment_documents;
create trigger trg_sync_shipment_document_to_file_manager
after insert or update of storage_path,storage_backend,file_asset_id,folder_id,original_file_name,mime_type,file_size_bytes
on public.shipment_documents
for each row execute function public.sync_shipment_document_to_file_manager();


-- The gateway inserts this mapping only after Telegram confirms successful storage.
-- File content is not scanned, OCR'd, or sent to an AI service by this path.
comment on table public.file_manager_files is
  'Logical links from customs shipment folders to Telegram-backed file_assets; metadata only, no file bytes.';

-- Search across current business records, declaration/pre-declaration fields, folder labels,
-- and document metadata. SECURITY INVOKER keeps underlying RLS policies in force.
create or replace function public.search_file_manager(p_query text, p_limit integer default 50)
returns table (
  entity_type text,
  entity_id uuid,
  title text,
  details text,
  folder_id uuid,
  shipment_id uuid,
  client_id uuid
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with query_arg as (
    select '%' || trim(coalesce(p_query, '')) || '%' as pattern
  ),
  hits as (
    select 'shipment'::text as entity_type, s.id as entity_id,
      coalesce(nullif(s.display_name, ''), 'محموله ' || left(s.id::text, 8)) as title,
      concat_ws(' • ', cl.name, v.name, o.name, o.code, s.bill_of_lading_no,
        s.bill_of_lading_year::text, s.voyage_no, s.origin_port, s.destination_port,
        s.current_status, ca.case_number, ca.registration_order_no, ca.proforma_no,
        ca.warehouse_receipt_no, scd.cargo_description, scd.tariff_code,
        scd.duty_rate::text, cd.kottaj_number, cd.declaration_date::text) as details,
      fm.id as folder_id, s.id as shipment_id, s.client_id as client_id,
      s.created_at as sort_at
    from public.shipments s
    left join public.clients cl on cl.id = s.client_id and cl.organization_id = s.organization_id
    left join public.vessels v on v.id = s.vessel_id and v.organization_id = s.organization_id
    left join public.cases ca on ca.id = s.case_id and ca.organization_id = s.organization_id
    left join public.customs_offices o on o.id = coalesce(s.customs_office_id, ca.customs_office_id)
    left join public.shipment_customs_data scd on scd.shipment_id = s.id and scd.organization_id = s.organization_id
    left join public.customs_declarations cd on cd.shipment_id = s.id and cd.organization_id = s.organization_id
    left join public.file_manager_folders fm on fm.shipment_id = s.id and fm.organization_id = s.organization_id and fm.folder_type = 'shipment'
    cross join query_arg q
    where s.organization_id = public.user_org_id()
      and (public.user_role()::text <> 'client' or s.client_id = public.user_client_id())
      and length(trim(coalesce(p_query, ''))) >= 2
      and (
        s.file_manager_search_text ilike q.pattern
        or cl.file_manager_search_text ilike q.pattern
        or v.file_manager_search_text ilike q.pattern
        or o.file_manager_search_text ilike q.pattern
        
        or ca.file_manager_search_text ilike q.pattern
        or scd.file_manager_search_text ilike q.pattern
        or cd.file_manager_search_text ilike q.pattern
      )

    union all

    select 'client'::text, c.id, c.name,
      concat_ws(' • ', c.economic_code, c.national_id, c.phone, c.address),
      fm.id, null::uuid, c.id, c.created_at
    from public.clients c
    left join public.file_manager_folders fm on fm.client_id = c.id and fm.organization_id = c.organization_id and fm.folder_type = 'client'
    cross join query_arg q
    where c.organization_id = public.user_org_id()
      and (public.user_role()::text <> 'client' or c.id = public.user_client_id())
      and length(trim(coalesce(p_query, ''))) >= 2
      and c.file_manager_search_text ilike q.pattern

    union all

    select 'vessel'::text, v.id, v.name,
      concat_ws(' • ', v.imo_number, v.mmsi_number, v.flag, v.flag_code, sl.name),
      fm.id, s.id, s.client_id, v.created_at
    from public.vessels v
    left join public.shipping_lines sl on sl.id = v.shipping_line_id
    left join public.shipments s on s.vessel_id = v.id and s.organization_id = v.organization_id
    left join public.file_manager_folders fm on fm.shipment_id = s.id and fm.organization_id = s.organization_id and fm.folder_type = 'shipment'
    cross join query_arg q
    where v.organization_id = public.user_org_id()
      and (
        public.user_role()::text <> 'client'
        or exists (select 1 from public.shipments sx
          where sx.organization_id = v.organization_id and sx.vessel_id = v.id
            and sx.client_id = public.user_client_id())
      )
      and length(trim(coalesce(p_query, ''))) >= 2
      and (v.file_manager_search_text ilike q.pattern or sl.file_manager_search_text ilike q.pattern)

    union all

    select 'declaration'::text, d.id,
      coalesce(nullif(d.kottaj_number, ''), 'اظهارنامه ' || left(d.id::text, 8)),
      concat_ws(' • ', d.declaration_date::text, d.customs_path, o.name, o.code,
        s.display_name, ca.case_number, ca.registration_order_no, ca.proforma_no),
      fm.id, d.shipment_id, coalesce(s.client_id, ca.client_id), d.created_at
    from public.customs_declarations d
    left join public.shipments s on s.id = d.shipment_id and s.organization_id = d.organization_id
    left join public.cases ca on ca.id = d.case_id and ca.organization_id = d.organization_id
    left join public.customs_offices o on o.id = d.customs_office_id
    left join public.file_manager_folders fm on fm.shipment_id = d.shipment_id and fm.organization_id = d.organization_id and fm.folder_type = 'shipment'
    cross join query_arg q
    where d.organization_id = public.user_org_id()
      and (public.user_role()::text <> 'client' or coalesce(s.client_id, ca.client_id) = public.user_client_id())
      and length(trim(coalesce(p_query, ''))) >= 2
      and (d.file_manager_search_text ilike q.pattern or ca.file_manager_search_text ilike q.pattern or coalesce(s.display_name, '') ilike q.pattern)

    union all

    select 'folder'::text, f.id, f.display_name,
      concat_ws(' • ', c.name, s.display_name, o.name, f.folder_type),
      f.id, f.shipment_id, f.client_id, f.updated_at
    from public.file_manager_folders f
    left join public.clients c on c.id = f.client_id and c.organization_id = f.organization_id
    left join public.shipments s on s.id = f.shipment_id and s.organization_id = f.organization_id
    left join public.customs_offices o on o.id = f.customs_office_id
    cross join query_arg q
    where f.organization_id = public.user_org_id()
      and (public.user_role()::text <> 'client' or f.folder_type = 'root' or f.client_id = public.user_client_id())
      and length(trim(coalesce(p_query, ''))) >= 2
      and (
        f.display_name ilike q.pattern
        or f.folder_key ilike q.pattern
        or c.file_manager_search_text ilike q.pattern
        or s.file_manager_search_text ilike q.pattern
        or o.file_manager_search_text ilike q.pattern
        or o.code ilike q.pattern
      )

    union all

    select 'file'::text, fm.id, fm.original_name,
      concat_ws(' • ', fm.mime_type, fm.size_bytes::text, fm.document_type,
        array_to_string(fm.tags, ' '), fm.metadata::text, f.display_name,
        s.display_name, c.name, o.name),
      fm.folder_id, fm.shipment_id, fm.client_id, fm.created_at
    from public.file_manager_files fm
    join public.file_manager_folders f on f.id = fm.folder_id and f.organization_id = fm.organization_id
    left join public.shipments s on s.id = fm.shipment_id and s.organization_id = fm.organization_id
    left join public.clients c on c.id = fm.client_id and c.organization_id = fm.organization_id
    left join public.customs_offices o on o.id = s.customs_office_id
    cross join query_arg q
    where fm.organization_id = public.user_org_id()
      and (public.user_role()::text <> 'client' or fm.client_id = public.user_client_id())
      and length(trim(coalesce(p_query, ''))) >= 2
      and (
        fm.file_manager_search_text ilike q.pattern
        or f.file_manager_search_text ilike q.pattern
        or s.display_name ilike q.pattern
        or c.name ilike q.pattern
        or o.name ilike q.pattern
      )

    union all

    select 'document'::text, sd.id, coalesce(sd.document_name, sd.original_file_name),
      concat_ws(' • ', sd.original_file_name, sd.mime_type, sd.file_size_bytes::text, s.display_name, c.name, o.name),
      fm.id, sd.shipment_id, s.client_id, sd.created_at
    from public.shipment_documents sd
    join public.shipments s on s.id = sd.shipment_id and s.organization_id = sd.organization_id
    left join public.clients c on c.id = s.client_id and c.organization_id = s.organization_id
    left join public.customs_offices o on o.id = s.customs_office_id
    left join public.file_manager_folders fm on fm.shipment_id = sd.shipment_id and fm.organization_id = sd.organization_id and fm.folder_type = 'shipment'
    cross join query_arg q
    where sd.organization_id = public.user_org_id()
      and (public.user_role()::text <> 'client' or s.client_id = public.user_client_id())
      and length(trim(coalesce(p_query, ''))) >= 2
      and sd.file_manager_search_text ilike q.pattern

    union all

    select 'customs_document'::text, cd.id, coalesce(cd.display_name, cd.original_name),
      concat_ws(' • ', cd.document_number, cd.tags::text, cd.document_type::text, cd.issue_date_shamsi,
        cd.importer_name, cd.exporter_name, cd.invoice_amount::text, s.display_name, c.name),
      fm.id, cd.shipment_id, coalesce(cd.client_id, s.client_id), cd.created_at
    from public.customs_documents cd
    left join public.shipments s on s.id = cd.shipment_id and s.organization_id = cd.organization_id
    left join public.clients c on c.id = coalesce(cd.client_id, s.client_id) and c.organization_id = cd.organization_id
    left join public.file_manager_folders fm on fm.shipment_id = cd.shipment_id and fm.organization_id = cd.organization_id and fm.folder_type = 'shipment'
    cross join query_arg q
    where cd.organization_id = public.user_org_id()
      and (public.user_role()::text <> 'client' or coalesce(cd.client_id, s.client_id) = public.user_client_id())
      and length(trim(coalesce(p_query, ''))) >= 2
      and cd.file_manager_search_text ilike q.pattern
  )
  select h.entity_type, h.entity_id, h.title, h.details, h.folder_id, h.shipment_id, h.client_id
  from hits h
  order by h.sort_at desc nulls last, h.title
  limit least(greatest(coalesce(p_limit, 50), 1), 100);
$$;

revoke all on function public.search_file_manager(text, integer) from public, anon;
grant execute on function public.search_file_manager(text, integer) to authenticated;
