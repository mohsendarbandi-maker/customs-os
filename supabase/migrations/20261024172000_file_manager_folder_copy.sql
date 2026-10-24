
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

-- Keep copied metadata aliases out of global search; they are visible only inside the copied folder.
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
    left join public.shipment_customs_data scd on scd.shipment_id = s.id and scd.organization_id = s.organization_id
    left join public.customs_offices o on o.id = coalesce(s.customs_office_id, ca.customs_office_id, scd.customs_office_id)
    and o.organization_id = s.organization_id
    left join public.customs_declarations cd on cd.shipment_id = s.id and cd.organization_id = s.organization_id
    left join public.file_manager_folders fm on fm.shipment_id = s.id and fm.organization_id = s.organization_id and fm.folder_type = 'shipment'
    cross join query_arg q
    where s.organization_id = public.user_org_id()
      and public.user_role()::text in ('owner', 'admin', 'broker', 'accountant', 'warehouse', 'client') and (public.user_role()::text <> 'client' or s.client_id = public.user_client_id())
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
      and public.user_role()::text in ('owner', 'admin', 'broker', 'accountant', 'warehouse', 'client') and (public.user_role()::text <> 'client' or c.id = public.user_client_id())
      and length(trim(coalesce(p_query, ''))) >= 2
      and c.file_manager_search_text ilike q.pattern

    union all

    select 'vessel'::text, v.id, v.name,
      concat_ws(' • ', v.imo_number, v.mmsi_number, v.flag, v.flag_code, sl.name),
      fm.id, s.id, s.client_id, v.created_at
    from public.vessels v
    left join public.shipping_lines sl on sl.id = v.shipping_line_id and sl.organization_id = v.organization_id
    left join public.shipments s on s.vessel_id = v.id and s.organization_id = v.organization_id
    left join public.file_manager_folders fm on fm.shipment_id = s.id and fm.organization_id = s.organization_id and fm.folder_type = 'shipment'
    cross join query_arg q
    where v.organization_id = public.user_org_id()
      and public.user_role()::text in ('owner', 'admin', 'broker', 'accountant', 'warehouse', 'client')
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
    left join public.customs_offices o on o.id = d.customs_office_id and o.organization_id = d.organization_id
    left join public.file_manager_folders fm on fm.shipment_id = d.shipment_id and fm.organization_id = d.organization_id and fm.folder_type = 'shipment'
    cross join query_arg q
    where d.organization_id = public.user_org_id()
      and public.user_role()::text in ('owner', 'admin', 'broker', 'accountant', 'warehouse', 'client') and (public.user_role()::text <> 'client' or coalesce(s.client_id, ca.client_id) = public.user_client_id())
      and length(trim(coalesce(p_query, ''))) >= 2
      and (d.file_manager_search_text ilike q.pattern or ca.file_manager_search_text ilike q.pattern or s.file_manager_search_text ilike q.pattern)

    union all

    select 'folder'::text, f.id, f.display_name,
      concat_ws(' • ', c.name, s.display_name, o.name, f.folder_type),
      f.id, f.shipment_id, f.client_id, f.updated_at
    from public.file_manager_folders f
    left join public.clients c on c.id = f.client_id and c.organization_id = f.organization_id
    left join public.shipments s on s.id = f.shipment_id and s.organization_id = f.organization_id
    left join public.customs_offices o on o.id = f.customs_office_id and o.organization_id = f.organization_id
    cross join query_arg q
    where f.organization_id = public.user_org_id()
      and public.user_role()::text in ('owner', 'admin', 'broker', 'accountant', 'warehouse', 'client') and (public.user_role()::text <> 'client' or f.folder_type = 'root' or f.client_id = public.user_client_id())
      and length(trim(coalesce(p_query, ''))) >= 2
      and (
        f.file_manager_search_text ilike q.pattern
        or c.file_manager_search_text ilike q.pattern
        or s.file_manager_search_text ilike q.pattern
        or o.file_manager_search_text ilike q.pattern

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
    left join public.customs_offices o on o.id = s.customs_office_id and o.organization_id = s.organization_id
    cross join query_arg q
    where fm.organization_id = public.user_org_id()
      and public.user_role()::text in ('owner', 'admin', 'broker', 'accountant', 'warehouse', 'client') and (public.user_role()::text <> 'client' or fm.client_id = public.user_client_id())
      and fm.shipment_document_id is null
      and fm.customs_document_id is null
      and not fm.is_archived
      and not (fm.metadata ? 'copyAliasSourceFileId')
      and length(trim(coalesce(p_query, ''))) >= 2
      and (
        fm.file_manager_search_text ilike q.pattern
        or f.file_manager_search_text ilike q.pattern
        or s.file_manager_search_text ilike q.pattern
        or c.file_manager_search_text ilike q.pattern
        or o.file_manager_search_text ilike q.pattern
      )

    union all

    select 'document'::text, sd.id, coalesce(sd.document_name, sd.original_file_name),
      concat_ws(' • ', sd.original_file_name, sd.mime_type, sd.file_size_bytes::text,
        fm_file.document_type, array_to_string(fm_file.tags, ' '), fm_file.metadata::text,
        s.display_name, c.name, o.name),
      coalesce(fm_file.folder_id, fm.id), sd.shipment_id, s.client_id, sd.created_at
    from public.shipment_documents sd
    join public.shipments s on s.id = sd.shipment_id and s.organization_id = sd.organization_id
    left join public.clients c on c.id = s.client_id and c.organization_id = s.organization_id
    left join public.customs_offices o on o.id = s.customs_office_id and o.organization_id = s.organization_id
    left join public.file_manager_folders fm on fm.shipment_id = sd.shipment_id and fm.organization_id = sd.organization_id and fm.folder_type = 'shipment'
    left join public.file_manager_files fm_file on fm_file.shipment_document_id = sd.id and fm_file.organization_id = sd.organization_id
    cross join query_arg q
    where sd.organization_id = public.user_org_id()
      and public.user_role()::text in ('owner', 'admin', 'broker', 'accountant', 'warehouse', 'client') and (public.user_role()::text <> 'client' or s.client_id = public.user_client_id())
      and not exists (select 1 from public.customs_documents mirror
        where mirror.id = sd.id and mirror.organization_id = sd.organization_id)
      and length(trim(coalesce(p_query, ''))) >= 2
      and not coalesce(sd.is_archived, false)
      and not coalesce(fm_file.is_archived, false)
      -- Shipment documents mirrored into customs_documents are emitted only once below.
      and not exists (
        select 1 from public.customs_documents cd
        where cd.id = sd.id and cd.organization_id = sd.organization_id
      )
      and (sd.file_manager_search_text ilike q.pattern or fm_file.file_manager_search_text ilike q.pattern)

    union all

    select 'customs_document'::text, cd.id, coalesce(cd.display_name, cd.original_name),
      concat_ws(' • ', cd.document_number, cd.tags::text, cd.document_type::text, cd.issue_date_shamsi,
        cd.importer_name, cd.exporter_name, cd.invoice_amount::text, fm_file.document_type,
        array_to_string(fm_file.tags, ' '), fm_file.metadata::text, s.display_name, c.name),
      coalesce(fm_file.folder_id, fm.id), cd.shipment_id, coalesce(cd.client_id, s.client_id), cd.created_at
    from public.customs_documents cd
    left join public.shipments s on s.id = cd.shipment_id and s.organization_id = cd.organization_id
    left join public.clients c on c.id = coalesce(cd.client_id, s.client_id) and c.organization_id = cd.organization_id
    left join public.file_manager_folders fm on fm.shipment_id = cd.shipment_id and fm.organization_id = cd.organization_id and fm.folder_type = 'shipment'
    left join public.file_manager_files fm_file
      on fm_file.organization_id = cd.organization_id
      and (fm_file.customs_document_id = cd.id or fm_file.shipment_document_id = cd.id)
    cross join query_arg q
    where cd.organization_id = public.user_org_id()
      and public.user_role()::text in ('owner', 'admin', 'broker', 'accountant', 'warehouse', 'client') and (public.user_role()::text <> 'client' or coalesce(cd.client_id, s.client_id) = public.user_client_id())
      and length(trim(coalesce(p_query, ''))) >= 2
      and not coalesce(cd.is_archived, false)
      and not coalesce(fm_file.is_archived, false)
      and (cd.file_manager_search_text ilike q.pattern or fm_file.file_manager_search_text ilike q.pattern)
  )
  select h.entity_type, h.entity_id, h.title, h.details, h.folder_id, h.shipment_id, h.client_id
  from hits h
  order by h.sort_at desc nulls last, h.title
  limit least(greatest(coalesce(p_limit, 50), 1), 100);
$$;
notify pgrst, 'reload schema';
