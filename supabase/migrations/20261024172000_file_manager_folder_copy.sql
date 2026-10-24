
-- Safe logical folder copy/paste. File bytes are never copied or moved.
-- File entries in a copied folder are aliases to the original Telegram asset or legacy storage path.

alter table public.file_manager_files
  drop constraint if exists file_manager_files_has_source_check;
alter table public.file_manager_files
  add constraint file_manager_files_has_source_check check (
    file_asset_id is not null
    or shipment_document_id is not null
    or customs_document_id is not null
    or storage_path is not null
  );

create or replace function public.copy_file_manager_folder(
  p_source_folder_id uuid,
  p_target_parent_id uuid,
  p_new_display_name text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_org uuid := public.user_org_id();
  v_role text := public.user_role()::text;
  v_source public.file_manager_folders%rowtype;
  v_target public.file_manager_folders%rowtype;
  v_node record;
  v_file record;
  v_new_id uuid;
  v_new_root_id uuid;
  v_new_parent_id uuid;
  v_mapping jsonb := '{}'::jsonb;
  v_target_inside boolean := false;
  v_new_name text;
begin
  if v_actor is null or v_org is null then raise exception 'FILE_MANAGER_COPY_AUTH_REQUIRED'; end if;
  if v_role not in ('owner','admin','broker','accountant','warehouse','client') then raise exception 'FILE_MANAGER_COPY_ROLE_FORBIDDEN'; end if;
  if p_source_folder_id is null or p_target_parent_id is null then raise exception 'FILE_MANAGER_COPY_INVALID_INPUT'; end if;

  select * into v_source from public.file_manager_folders where id=p_source_folder_id and organization_id=v_org;
  if not found then raise exception 'FILE_MANAGER_COPY_SOURCE_NOT_FOUND'; end if;
  select * into v_target from public.file_manager_folders where id=p_target_parent_id and organization_id=v_org;
  if not found then raise exception 'FILE_MANAGER_COPY_TARGET_NOT_FOUND'; end if;

  if v_source.folder_type in ('root','client','shipment') then raise exception 'FILE_MANAGER_COPY_PROTECTED_FOLDER'; end if;
  if v_target.folder_type='root' then raise exception 'FILE_MANAGER_COPY_TARGET_NOT_FOLDER'; end if;
  if v_source.client_id is distinct from v_target.client_id
     or v_source.shipment_id is distinct from v_target.shipment_id
     or v_source.customs_office_id is distinct from v_target.customs_office_id then
    raise exception 'FILE_MANAGER_COPY_SCOPE_MISMATCH';
  end if;
  if v_role='client' and (
    v_source.client_id is distinct from public.user_client_id()
    or v_target.client_id is distinct from public.user_client_id()
  ) then raise exception 'FILE_MANAGER_COPY_CLIENT_SCOPE_FORBIDDEN'; end if;

  with recursive subtree(id,path) as (
    select f.id,array[f.id] from public.file_manager_folders f where f.id=v_source.id and f.organization_id=v_org
    union all
    select ch.id,st.path||ch.id from public.file_manager_folders ch join subtree st on ch.parent_id=st.id
    where ch.organization_id=v_org and not ch.id=any(st.path)
  ) select exists(select 1 from subtree where id=v_target.id) into v_target_inside;
  if v_target_inside then raise exception 'FILE_MANAGER_COPY_TARGET_INSIDE_SOURCE'; end if;

  v_new_root_id:=gen_random_uuid();
  v_new_name:=left(replace(replace(trim(coalesce(nullif(p_new_display_name,''),v_source.display_name||' - کپی')),'/','／'),chr(92),'／'),120);
  insert into public.file_manager_folders(id,organization_id,parent_id,folder_key,folder_type,display_name,client_id,shipment_id,customs_office_id,is_system,created_by)
  values(v_new_root_id,v_org,v_target.id,'custom:copy:'||v_new_root_id::text,'custom',v_new_name,v_target.client_id,v_target.shipment_id,v_target.customs_office_id,false,v_actor);
  v_mapping:=jsonb_build_object(v_source.id::text,v_new_root_id::text);

  for v_node in
    with recursive subtree(id,parent_id,depth,path) as (
      select f.id,f.parent_id,0,array[f.id] from public.file_manager_folders f where f.id=v_source.id and f.organization_id=v_org
      union all
      select ch.id,ch.parent_id,st.depth+1,st.path||ch.id from public.file_manager_folders ch join subtree st on ch.parent_id=st.id
      where ch.organization_id=v_org and not ch.id=any(st.path)
    ) select id,parent_id from subtree where depth>0 order by depth,id
  loop
    v_new_id:=gen_random_uuid();
    v_new_parent_id:=(v_mapping->>v_node.parent_id::text)::uuid;
    if v_new_parent_id is null then raise exception 'FILE_MANAGER_COPY_TREE_MAPPING_FAILED'; end if;
    insert into public.file_manager_folders(id,organization_id,parent_id,folder_key,folder_type,display_name,client_id,shipment_id,customs_office_id,is_system,created_by)
    select v_new_id,v_org,v_new_parent_id,'custom:copy:'||v_new_id::text,
      case when src.folder_type in ('root','client','shipment') then 'custom' else src.folder_type end,
      src.display_name,v_target.client_id,v_target.shipment_id,v_target.customs_office_id,false,v_actor
    from public.file_manager_folders src where src.id=v_node.id and src.organization_id=v_org;
    v_mapping:=v_mapping||jsonb_build_object(v_node.id::text,v_new_id::text);
  end loop;

  for v_file in
    with recursive subtree(id,path) as (
      select f.id,array[f.id] from public.file_manager_folders f where f.id=v_source.id and f.organization_id=v_org
      union all
      select ch.id,st.path||ch.id from public.file_manager_folders ch join subtree st on ch.parent_id=st.id
      where ch.organization_id=v_org and not ch.id=any(st.path)
    )
    select fm.* from public.file_manager_files fm join subtree st on st.id=fm.folder_id
    where fm.organization_id=v_org
    order by fm.created_at,fm.id
  loop
    if v_file.file_asset_id is null and nullif(v_file.storage_path,'') is null then
      raise exception 'FILE_MANAGER_COPY_FILE_SOURCE_MISSING';
    end if;
    v_new_parent_id:=(v_mapping->>v_file.folder_id::text)::uuid;
    if v_new_parent_id is null then raise exception 'FILE_MANAGER_COPY_TREE_MAPPING_FAILED'; end if;
    insert into public.file_manager_files(
      organization_id,folder_id,shipment_id,client_id,file_asset_id,original_name,mime_type,size_bytes,
      external_message_id,document_type,tags,metadata,is_archived,shipment_document_id,customs_document_id,
      storage_path,created_by
    ) values(
      v_org,v_new_parent_id,v_target.shipment_id,v_target.client_id,null,v_file.original_name,v_file.mime_type,v_file.size_bytes,
      v_file.external_message_id,v_file.document_type,coalesce(v_file.tags,'{}'::text[]),
      coalesce(v_file.metadata,'{}'::jsonb)||jsonb_strip_nulls(jsonb_build_object(
        'copyAliasSourceFileId',v_file.id,
        'copyAliasFileAssetId',v_file.file_asset_id,
        'copyAliasCreatedAt',now()
      )),
      v_file.is_archived,null,null,
      case when v_file.file_asset_id is not null then 'telegram://'||v_file.file_asset_id::text else v_file.storage_path end,
      v_actor
    );
  end loop;
  return v_new_root_id;
end;
$$;

revoke all on function public.copy_file_manager_folder(uuid,uuid,text) from public,anon;
grant execute on function public.copy_file_manager_folder(uuid,uuid,text) to authenticated;

-- Preserve the deployed search function's existing metadata, office and document logic.
-- Only exclude folder-copy aliases from global search; aliases remain visible inside their copied folder.
do $migration$
declare
  v_definition text;
  v_count integer;
begin
  select pg_get_functiondef('public.search_file_manager(text,integer)'::regprocedure)
    into v_definition;
  if v_definition is null then
    raise exception 'FILE_MANAGER_SEARCH_FUNCTION_MISSING';
  end if;

  if position('copyAliasSourceFileId' in v_definition) = 0 then
    v_count := (
      length(v_definition) - length(replace(v_definition, 'and not fm.is_archived', ''))
    ) / length('and not fm.is_archived');
    if v_count <> 1 then
      raise exception 'FILE_MANAGER_SEARCH_FUNCTION_SHAPE_CHANGED';
    end if;
    v_definition := replace(
      v_definition,
      'and not fm.is_archived',
      E'and not fm.is_archived\n      and not (fm.metadata ? ''copyAliasSourceFileId'')'
    );
    execute v_definition;
  end if;
end
$migration$;

notify pgrst, 'reload schema';
