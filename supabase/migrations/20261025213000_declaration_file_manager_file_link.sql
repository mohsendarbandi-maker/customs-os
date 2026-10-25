-- Link a declaration to an existing canonical File Manager record without copying its binary.
alter table public.customs_declarations
  add column if not exists declaration_file_manager_file_id uuid
  references public.file_manager_files(id) on delete set null;

create index if not exists customs_declarations_file_manager_file_idx
  on public.customs_declarations (organization_id, declaration_file_manager_file_id)
  where declaration_file_manager_file_id is not null;

create or replace function public.validate_declaration_file_manager_scope()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $function$
declare
  v_file_org uuid;
begin
  if new.declaration_file_manager_file_id is null then
    return new;
  end if;

  select f.organization_id
    into v_file_org
  from public.file_manager_files f
  where f.id = new.declaration_file_manager_file_id;

  if v_file_org is null or v_file_org is distinct from new.organization_id then
    raise exception 'DECLARATION_FILE_MANAGER_SCOPE_MISMATCH';
  end if;

  return new;
end;
$function$;

revoke all on function public.validate_declaration_file_manager_scope() from public, anon, authenticated;

drop trigger if exists trg_validate_declaration_file_manager_scope on public.customs_declarations;
create trigger trg_validate_declaration_file_manager_scope
before insert or update of declaration_file_manager_file_id, organization_id
on public.customs_declarations
for each row execute function public.validate_declaration_file_manager_scope();
