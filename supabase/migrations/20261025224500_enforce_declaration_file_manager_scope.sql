-- Enforce same-shipment / same-cargo-owner scope for declaration file links.
-- The existing file-manager row remains canonical; this migration only validates the pointer.
create or replace function public.validate_declaration_file_manager_scope()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $function$
declare
  v_file public.file_manager_files%rowtype;
  v_shipment_client_id uuid;
  v_case_id uuid;
begin
  if new.declaration_file_manager_file_id is null then
    return new;
  end if;

  select f.*
    into v_file
  from public.file_manager_files f
  where f.id = new.declaration_file_manager_file_id;

  if not found
     or v_file.organization_id is distinct from new.organization_id
     or v_file.is_archived is true then
    raise exception 'DECLARATION_FILE_MANAGER_SCOPE_MISMATCH';
  end if;

  if new.shipment_id is null then
    raise exception 'DECLARATION_FILE_MANAGER_SCOPE_MISMATCH';
  end if;

  -- Shipment files may be linked directly. Owner-level files may be linked only
  -- when they belong to the shipment owner; a sibling shipment's file is not allowed.
  if v_file.shipment_id = new.shipment_id then
    return new;
  end if;

  if v_file.shipment_id is not null then
    raise exception 'DECLARATION_FILE_MANAGER_SCOPE_MISMATCH';
  end if;

  select s.client_id, s.case_id
    into v_shipment_client_id, v_case_id
  from public.shipments s
  where s.id = new.shipment_id
    and s.organization_id = new.organization_id;

  if not found then
    raise exception 'DECLARATION_FILE_MANAGER_SCOPE_MISMATCH';
  end if;

  if v_shipment_client_id is null and v_case_id is not null then
    select c.client_id
      into v_shipment_client_id
    from public.cases c
    where c.id = v_case_id
      and c.organization_id = new.organization_id;
  end if;

  if v_shipment_client_id is null
     or v_file.client_id is distinct from v_shipment_client_id then
    raise exception 'DECLARATION_FILE_MANAGER_SCOPE_MISMATCH';
  end if;

  return new;
end;
$function$;

revoke all on function public.validate_declaration_file_manager_scope() from public, anon, authenticated;
