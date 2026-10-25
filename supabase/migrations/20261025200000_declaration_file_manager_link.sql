begin;

-- The file manager is the canonical document library. A declaration may reference
-- an existing file-manager row without uploading its binary content a second time.
alter table public.file_manager_files
  add constraint file_manager_files_id_organization_id_unique
  unique (id, organization_id);

alter table public.customs_declarations
  add column if not exists declaration_file_manager_file_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'customs_declarations_file_manager_file_same_org_fk'
      and conrelid = 'public.customs_declarations'::regclass
  ) then
    alter table public.customs_declarations
      add constraint customs_declarations_file_manager_file_same_org_fk
      foreign key (declaration_file_manager_file_id, organization_id)
      references public.file_manager_files (id, organization_id)
      on update restrict
      on delete restrict
      not valid;
  end if;
end
$$;

alter table public.customs_declarations
  validate constraint customs_declarations_file_manager_file_same_org_fk;

create index if not exists customs_declarations_file_manager_file_id_idx
  on public.customs_declarations (declaration_file_manager_file_id)
  where declaration_file_manager_file_id is not null;

create or replace function public.set_declaration_file_manager_file(
  p_declaration_id uuid,
  p_file_manager_file_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid := public.user_org_id();
  v_role text := public.user_role();
  v_shipment_id uuid;
  v_client_id uuid;
  v_file public.file_manager_files%rowtype;
begin
  if v_org is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  if v_role not in ('owner', 'admin', 'broker', 'accountant', 'warehouse', 'client') then
    raise exception 'DECLARATION_FILE_ROLE_FORBIDDEN' using errcode = '42501';
  end if;

  select d.shipment_id, s.client_id
    into v_shipment_id, v_client_id
  from public.customs_declarations d
  join public.shipments s
    on s.id = d.shipment_id
   and s.organization_id = d.organization_id
  where d.id = p_declaration_id
    and d.organization_id = v_org;

  if not found then
    raise exception 'DECLARATION_NOT_FOUND' using errcode = 'P0002';
  end if;

  if p_file_manager_file_id is null then
    update public.customs_declarations
       set declaration_file_manager_file_id = null
     where id = p_declaration_id
       and organization_id = v_org;
    return;
  end if;

  select fm.*
    into v_file
  from public.file_manager_files fm
  where fm.id = p_file_manager_file_id
    and fm.organization_id = v_org
    and fm.is_archived = false
    and (
      fm.shipment_id = v_shipment_id
      or (
        v_client_id is not null
        and fm.client_id = v_client_id
        and fm.shipment_id is null
      )
    );

  if not found then
    raise exception 'DECLARATION_FILE_SCOPE_MISMATCH' using errcode = '42501';
  end if;

  if v_role = 'client' and v_file.client_id is distinct from public.user_client_id() then
    raise exception 'DECLARATION_FILE_ACCESS_DENIED' using errcode = '42501';
  end if;

  update public.customs_declarations
     set declaration_file_manager_file_id = v_file.id,
         declaration_file_name = v_file.original_name,
         declaration_file_path = case
           when coalesce(v_file.storage_path, '') like 'telegram://%' then null
           else v_file.storage_path
         end,
         declaration_file_uploaded_at = now()
   where id = p_declaration_id
     and organization_id = v_org;

  if not found then
    raise exception 'DECLARATION_NOT_FOUND' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.set_declaration_file_manager_file(uuid, uuid) from public;
grant execute on function public.set_declaration_file_manager_file(uuid, uuid) to authenticated;

comment on column public.customs_declarations.declaration_file_manager_file_id is
  'Optional link to the canonical file-manager record; avoids a duplicate binary upload.';

commit;
