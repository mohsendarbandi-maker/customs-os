-- Per-file customs metadata and stage-scoped AI extraction.
-- Each source document remains one logical file in File Manager; original and display names are separate.

alter table public.customs_documents
  add column if not exists declaration_id uuid references public.customs_declarations(id) on delete set null,
  add column if not exists description text,
  add column if not exists operation_stage text,
  add column if not exists extraction_status text not null default 'pending',
  add column if not exists extraction_error text,
  add column if not exists extraction_completed_at timestamptz;

alter table public.shipment_documents
  add column if not exists document_type text,
  add column if not exists description text,
  add column if not exists tags text[] not null default '{}'::text[],
  add column if not exists operation_stage text;

alter table public.customs_documents
  drop constraint if exists customs_documents_extraction_status_check;
alter table public.customs_documents
  add constraint customs_documents_extraction_status_check
  check (extraction_status in ('pending', 'processing', 'completed', 'failed', 'skipped'));

create index if not exists customs_documents_declaration_stage_idx
  on public.customs_documents (organization_id, declaration_id, operation_stage, created_at desc)
  where is_archived = false;

-- Legacy attachments are visible in the base-documents box but are not
-- automatically sent to the AI provider on first migration.
update public.shipment_documents
set operation_stage = 'documents'
where operation_stage is null;

update public.customs_documents
set operation_stage = coalesce(operation_stage, 'documents'),
    extraction_status = case when extraction_status = 'pending' then 'skipped' else extraction_status end
where operation_stage is null or extraction_status = 'pending';


create index if not exists shipment_documents_operation_stage_idx
  on public.shipment_documents (organization_id, shipment_id, operation_stage, created_at desc)
  where is_archived = false;

create or replace function public.sync_customs_document_to_file_manager()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_client uuid;
  v_shipment uuid;
  v_folder uuid;
  v_rows integer := 0;
  v_shipment_mirror uuid;
  v_metadata jsonb;
begin
  v_shipment := new.shipment_id;
  v_client := new.client_id;

  if v_shipment is not null then
    select coalesce(s.client_id, ca.client_id) into v_client
    from public.shipments s
    left join public.cases ca on ca.id=s.case_id and ca.organization_id=s.organization_id
    where s.id = v_shipment and s.organization_id = new.organization_id;
    v_client := coalesce(new.client_id, v_client);
  end if;

  if coalesce(new.is_archived, false) then
    update public.file_manager_files
    set is_archived = true, updated_at = now()
    where organization_id = new.organization_id
      and (customs_document_id = new.id or shipment_document_id = new.id
        or (new.file_asset_id is not null and file_asset_id = new.file_asset_id));
    return new;
  end if;

  select f.id into v_folder
  from public.file_manager_folders f
  where f.id = new.folder_id
    and f.organization_id = new.organization_id
    and f.shipment_id is not distinct from v_shipment
    and f.client_id is not distinct from v_client
  limit 1;

  if v_folder is null and v_shipment is not null then
    select f.id into v_folder
    from public.file_manager_folders f
    where f.organization_id = new.organization_id
      and f.shipment_id = v_shipment and f.folder_type = 'other'
    limit 1;
  elsif v_folder is null and v_client is not null then
    select f.id into v_folder
    from public.file_manager_folders f
    where f.organization_id = new.organization_id
      and f.client_id = v_client and f.folder_type = 'client'
    limit 1;
  end if;

  if v_folder is null and v_shipment is null and v_client is null then
    select f.id into v_folder
    from public.file_manager_folders f
    where f.organization_id = new.organization_id
      and f.folder_key = 'unassigned-documents'
      and f.folder_type = 'other'
      and f.shipment_id is null
      and f.client_id is null
      and f.parent_id = (
        select root.id from public.file_manager_folders root
        where root.organization_id = new.organization_id
          and root.parent_id is null and root.folder_key = 'owners-root'
        limit 1
      )
    limit 1;
  end if;

  if v_folder is null then
    return new;
  end if;

  select sd.id into v_shipment_mirror
  from public.shipment_documents sd
  where sd.id=new.id and sd.organization_id=new.organization_id
  limit 1;

  v_metadata := jsonb_strip_nulls(jsonb_build_object(
    'legacyStorageBackend', coalesce(new.storage_backend, 'supabase'),
    'documentName', new.display_name,
    'documentDescription', new.description,
    'documentNumber', new.document_number,
    'documentIssueDate', new.issue_date_shamsi,
    'customsOperationStage', new.operation_stage,
    'customsExtraction', new.extraction,
    'customsExtractionStatus', new.extraction_status,
    'customsDeclarationId', new.declaration_id
  ));

  -- A customized display title must never replace the source filename.
  update public.file_manager_files
  set folder_id=v_folder,
      shipment_id=v_shipment,
      client_id=v_client,
      file_asset_id=coalesce(new.file_asset_id,file_asset_id),
      original_name=new.original_name,
      mime_type=coalesce(new.mime_type,'application/octet-stream'),
      size_bytes=greatest(coalesce(new.size_bytes,0),0),
      customs_document_id=new.id,
      shipment_document_id=coalesce(v_shipment_mirror,shipment_document_id),
      document_type=coalesce(new.document_type::text,'other'),
      tags=coalesce(new.tags,'{}'::text[]),
      storage_path=new.storage_path,
      metadata=coalesce(metadata,'{}'::jsonb) || v_metadata,
      created_by=coalesce(created_by,new.created_by),
      is_archived=false,
      updated_at=now()
  where organization_id=new.organization_id
    and (customs_document_id=new.id or shipment_document_id=new.id
      or (new.file_asset_id is not null and file_asset_id=new.file_asset_id));
  get diagnostics v_rows = row_count;

  if v_rows = 0 then
    insert into public.file_manager_files
      (organization_id, folder_id, shipment_id, client_id, file_asset_id,
       original_name, mime_type, size_bytes, document_type, tags, metadata,
       shipment_document_id, customs_document_id, storage_path, created_by, is_archived)
    values
      (new.organization_id, v_folder, v_shipment, v_client, new.file_asset_id,
       new.original_name,
       coalesce(new.mime_type, 'application/octet-stream'),
       greatest(coalesce(new.size_bytes, 0), 0),
       coalesce(new.document_type::text, 'other'), coalesce(new.tags, '{}'::text[]),
       v_metadata,
       v_shipment_mirror, new.id, new.storage_path, new.created_by, false)
    on conflict do nothing;
  end if;

  return new;
end;
$function$;

create or replace function public.sync_shipment_document_to_customs_documents()
returns trigger
language plpgsql
set search_path to 'public', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_document_type public.customs_document_type;
begin
  if new.document_type is not null then
    begin
      v_document_type := new.document_type::public.customs_document_type;
    exception when invalid_text_representation then
      v_document_type := null;
    end;
  end if;

  insert into public.customs_documents
    (id, organization_id, shipment_id, original_name, display_name, storage_path, mime_type,
     size_bytes, created_by, status, tags, created_at, updated_at, storage_backend,
     file_asset_id, folder_id, telegram_message_id, is_archived, archived_at, archived_by,
     archive_reason, document_type, description, operation_stage)
  values
    (new.id, new.organization_id, new.shipment_id, new.original_file_name, new.document_name,
     new.storage_path, new.mime_type, new.file_size_bytes, new.uploaded_by, 'review',
     coalesce(new.tags, '{}'::text[]), new.created_at, new.updated_at, new.storage_backend,
     new.file_asset_id, new.folder_id, new.telegram_message_id, new.is_archived,
     new.archived_at, new.archived_by, new.archive_reason,
     v_document_type, new.description, new.operation_stage)
  on conflict (id) do update set
    organization_id = excluded.organization_id,
    shipment_id = excluded.shipment_id,
    original_name = excluded.original_name,
    display_name = excluded.display_name,
    storage_path = excluded.storage_path,
    mime_type = excluded.mime_type,
    size_bytes = excluded.size_bytes,
    created_by = excluded.created_by,
    updated_at = excluded.updated_at,
    storage_backend = excluded.storage_backend,
    file_asset_id = excluded.file_asset_id,
    folder_id = excluded.folder_id,
    telegram_message_id = excluded.telegram_message_id,
    is_archived = excluded.is_archived,
    archived_at = excluded.archived_at,
    archived_by = excluded.archived_by,
    archive_reason = excluded.archive_reason,
    document_type = coalesce(excluded.document_type, public.customs_documents.document_type),
    description = coalesce(excluded.description, public.customs_documents.description),
    operation_stage = coalesce(excluded.operation_stage, public.customs_documents.operation_stage),
    tags = case when cardinality(excluded.tags) > 0 then excluded.tags else public.customs_documents.tags end;
  return new;
end;
$function$;

create or replace function public.sync_shipment_document_to_file_manager()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_client uuid;
  v_folder uuid;
  v_rows integer := 0;
  v_customs_mirror uuid;
  v_metadata jsonb;
begin
  if coalesce(new.is_archived, false) then
    update public.file_manager_files
    set is_archived = true, updated_at = now()
    where organization_id = new.organization_id
      and (shipment_document_id = new.id or customs_document_id = new.id
        or (new.file_asset_id is not null and file_asset_id = new.file_asset_id));
    return new;
  end if;

  select coalesce(s.client_id, ca.client_id) into v_client
  from public.shipments s
  left join public.cases ca on ca.id=s.case_id and ca.organization_id=s.organization_id
  where s.id=new.shipment_id and s.organization_id=new.organization_id;

  select f.id into v_folder
  from public.file_manager_folders f
  where f.id=new.folder_id
    and f.organization_id=new.organization_id
    and f.shipment_id=new.shipment_id
  limit 1;

  if v_folder is null then
    select f.id into v_folder
    from public.file_manager_folders f
    where f.organization_id=new.organization_id and f.shipment_id=new.shipment_id
      and f.folder_type='other'
    limit 1;
  end if;

  if v_folder is null then
    return new;
  end if;

  select cd.id into v_customs_mirror
  from public.customs_documents cd
  where cd.id=new.id and cd.organization_id=new.organization_id
  limit 1;

  v_metadata := jsonb_strip_nulls(jsonb_build_object(
    'legacyStorageBackend', coalesce(new.storage_backend, 'supabase'),
    'documentName', new.document_name,
    'documentDescription', new.description,
    'documentType', new.document_type,
    'customsOperationStage', new.operation_stage,
    'documentTags', coalesce(new.tags, '{}'::text[])
  ));

  -- The paired customs_documents row is a mirror, not a second logical file.
  update public.file_manager_files
  set folder_id=v_folder,
      shipment_id=new.shipment_id,
      client_id=v_client,
      file_asset_id=coalesce(new.file_asset_id,file_asset_id),
      original_name=new.original_file_name,
      mime_type=coalesce(new.mime_type,'application/octet-stream'),
      size_bytes=greatest(coalesce(new.file_size_bytes,0),0),
      shipment_document_id=new.id,
      customs_document_id=coalesce(v_customs_mirror,customs_document_id),
      document_type=coalesce(new.document_type,'other'),
      tags=coalesce(new.tags,'{}'::text[]),
      storage_path=new.storage_path,
      metadata=coalesce(metadata,'{}'::jsonb) || v_metadata,
      created_by=coalesce(created_by,new.uploaded_by),
      is_archived=false,
      updated_at=now()
  where organization_id=new.organization_id
    and (shipment_document_id=new.id or customs_document_id=new.id
      or (new.file_asset_id is not null and file_asset_id=new.file_asset_id));
  get diagnostics v_rows = row_count;

  if v_rows = 0 then
    insert into public.file_manager_files
      (organization_id,folder_id,shipment_id,client_id,file_asset_id,original_name,mime_type,size_bytes,
       document_type,tags,metadata,shipment_document_id,customs_document_id,storage_path,created_by)
    values
      (new.organization_id,v_folder,new.shipment_id,v_client,new.file_asset_id,
       new.original_file_name,coalesce(new.mime_type,'application/octet-stream'),
       greatest(coalesce(new.file_size_bytes,0),0),coalesce(new.document_type,'other'),
       coalesce(new.tags,'{}'::text[]),v_metadata,
       new.id,v_customs_mirror,new.storage_path,new.uploaded_by)
    on conflict do nothing;
  end if;

  return new;
end;
$function$;
