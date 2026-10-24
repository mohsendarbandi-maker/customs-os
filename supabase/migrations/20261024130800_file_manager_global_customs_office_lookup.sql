-- Fix lookup of globally shared customs offices (organization_id IS NULL).
-- Refresh existing folder names and make global search include the office name/code.
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
  select s.organization_id, coalesce(s.client_id, ca.client_id), s.id,
         coalesce(nullif(trim(c.name), ''), nullif(trim(case_client.name), ''), 'صاحب کالا'),
         coalesce(nullif(trim(s.display_name), ''), 'محموله ' || left(s.id::text, 8)),
         coalesce(s.customs_office_id, ca.customs_office_id, scd.customs_office_id),
         coalesce(nullif(trim(o.name), ''), nullif(trim(o.code), ''), 'گمرک نامشخص')
  into v_org, v_client, v_shipment, v_client_name, v_shipment_name, v_office_id, v_office_name
  from public.shipments s
  left join public.cases ca
    on ca.id = s.case_id and ca.organization_id = s.organization_id
  left join public.clients c
    on c.id = s.client_id and c.organization_id = s.organization_id
  left join public.clients case_client
    on case_client.id = ca.client_id and case_client.organization_id = s.organization_id
  left join public.shipment_customs_data scd
    on scd.shipment_id = s.id and scd.organization_id = s.organization_id
  left join public.customs_offices o
    on o.id = coalesce(s.customs_office_id, ca.customs_office_id, scd.customs_office_id)
    and (o.organization_id = s.organization_id or o.organization_id is null)
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

  -- If shipment ownership changes, the logical file metadata must follow the new owner.
  -- This updates only database links/metadata; it never moves or duplicates the file bytes.
  update public.file_manager_files
  set client_id = v_client, updated_at = now()
  where organization_id = v_org and shipment_id = v_shipment
    and client_id is distinct from v_client;

  update public.customs_documents
  set client_id = v_client, updated_at = now()
  where organization_id = v_org and shipment_id = v_shipment
    and client_id is distinct from v_client;
end;
$$;

revoke all on function public.ensure_shipment_file_manager_folders(uuid) from public, anon, authenticated;

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
    and (o.organization_id = s.organization_id or o.organization_id is null)
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
    left join public.customs_offices o on o.id = d.customs_office_id and (o.organization_id = d.organization_id or o.organization_id is null)
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
    left join public.customs_offices o on o.id = f.customs_office_id and (o.organization_id = f.organization_id or o.organization_id is null)
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
    left join public.cases ca on ca.id = s.case_id and ca.organization_id = s.organization_id
    left join public.shipment_customs_data scd on scd.shipment_id = s.id and scd.organization_id = s.organization_id
    left join public.clients c on c.id = fm.client_id and c.organization_id = fm.organization_id
    left join public.customs_offices o on o.id = coalesce(s.customs_office_id, ca.customs_office_id, scd.customs_office_id)
      and (o.organization_id = s.organization_id or o.organization_id is null)
    cross join query_arg q
    where fm.organization_id = public.user_org_id()
      and public.user_role()::text in ('owner', 'admin', 'broker', 'accountant', 'warehouse', 'client') and (public.user_role()::text <> 'client' or fm.client_id = public.user_client_id())
      and fm.shipment_document_id is null
      and fm.customs_document_id is null
      and not fm.is_archived
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
    left join public.customs_offices o on o.id = s.customs_office_id and (o.organization_id = s.organization_id or o.organization_id is null)
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

revoke all on function public.search_file_manager(text, integer) from public, anon;
grant execute on function public.search_file_manager(text, integer) to authenticated;

select public.ensure_shipment_file_manager_folders(s.id)
from public.shipments s;
