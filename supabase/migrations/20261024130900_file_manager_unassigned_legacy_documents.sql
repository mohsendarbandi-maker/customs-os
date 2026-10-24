-- Keep legacy documents that have no shipment/client association visible without guessing
-- an owner. New orphan records use the same review folder until explicitly associated.
insert into public.file_manager_folders
  (organization_id,parent_id,folder_key,folder_type,display_name,shipment_id,client_id,
   customs_office_id,is_system)
select o.id,null,'owners-root','root','صاحبان کالا',null,null,null,true
from public.organizations o
where exists (
  select 1 from public.customs_documents cd
  where cd.organization_id=o.id and cd.shipment_id is null and cd.client_id is null
    and cd.case_id is null and not coalesce(cd.is_archived,false)
)
and not exists (
  select 1 from public.file_manager_folders f
  where f.organization_id=o.id and f.parent_id is null and f.folder_key='owners-root'
)
on conflict do nothing;

insert into public.file_manager_folders
  (organization_id,parent_id,folder_key,folder_type,display_name,shipment_id,client_id,
   customs_office_id,is_system,is_editable)
select org.id,root.id,'unassigned-documents','other','اسناد نیازمند اتصال به محموله',
       null,null,null,true
from (
  select distinct cd.organization_id
  from public.customs_documents cd
  where cd.shipment_id is null and cd.client_id is null and cd.case_id is null
    and not coalesce(cd.is_archived,false)
) org
join public.file_manager_folders root
  on root.organization_id=org.organization_id and root.parent_id is null and root.folder_key='owners-root'
on conflict do nothing;

create or replace function public.sync_customs_document_to_file_manager()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_client uuid;
  v_shipment uuid;
  v_folder uuid;
  v_rows integer := 0;
  v_shipment_mirror uuid;
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

  -- Keep a single metadata row for records mirrored across both legacy tables.
  update public.file_manager_files
  set folder_id=v_folder,
      shipment_id=v_shipment,
      client_id=v_client,
      file_asset_id=coalesce(new.file_asset_id,file_asset_id),
      original_name=coalesce(new.display_name,new.original_name),
      mime_type=coalesce(new.mime_type,'application/octet-stream'),
      size_bytes=greatest(coalesce(new.size_bytes,0),0),
      customs_document_id=new.id,
      shipment_document_id=coalesce(v_shipment_mirror,shipment_document_id),
      document_type=coalesce(new.document_type::text,'other'),
      tags=coalesce(new.tags,'{}'::text[]),
      storage_path=new.storage_path,
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
       coalesce(new.display_name, new.original_name),
       coalesce(new.mime_type, 'application/octet-stream'),
       greatest(coalesce(new.size_bytes, 0), 0),
       coalesce(new.document_type::text, 'other'), coalesce(new.tags, '{}'::text[]),
       jsonb_build_object('legacyStorageBackend', coalesce(new.storage_backend, 'supabase')),
       v_shipment_mirror, new.id, new.storage_path, new.created_by, false)
    on conflict do nothing;
  end if;

  return new;
end;
$$;

revoke all on function public.sync_customs_document_to_file_manager() from public, anon, authenticated;

insert into public.file_manager_files
  (organization_id,folder_id,shipment_id,client_id,file_asset_id,original_name,mime_type,size_bytes,
   document_type,tags,metadata,shipment_document_id,customs_document_id,storage_path,created_by,is_archived)
select cd.organization_id,f.id,null,null,cd.file_asset_id,cd.original_name,
       coalesce(cd.mime_type,'application/octet-stream'),greatest(coalesce(cd.size_bytes,0),0),
       coalesce(cd.document_type::text,'other'),coalesce(cd.tags,'{}'::text[]),
       jsonb_build_object('legacyStorageBackend',coalesce(cd.storage_backend,'supabase'),
         'unassignedReason','legacy_document_without_owner_or_shipment'),
       null,cd.id,cd.storage_path,cd.created_by,false
from public.customs_documents cd
join public.file_manager_folders f
  on f.organization_id=cd.organization_id and f.folder_key='unassigned-documents'
 and f.folder_type='other' and f.shipment_id is null and f.client_id is null
where cd.shipment_id is null and cd.client_id is null and cd.case_id is null
  and not coalesce(cd.is_archived,false)
  and not exists (
    select 1 from public.file_manager_files existing
    where existing.organization_id=cd.organization_id
      and (existing.customs_document_id=cd.id or existing.shipment_document_id=cd.id
        or (cd.file_asset_id is not null and existing.file_asset_id=cd.file_asset_id))
  )
on conflict do nothing;
