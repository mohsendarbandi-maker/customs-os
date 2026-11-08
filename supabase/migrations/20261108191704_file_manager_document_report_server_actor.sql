create or replace function public.set_file_manager_document_report_actor()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  new.created_by := auth.uid();
  new.created_at := now();
  select p.full_name into new.actor_name
    from public.profiles p
   where p.id = auth.uid()
     and p.organization_id = new.organization_id;
  if new.actor_name is null or btrim(new.actor_name) = '' then
    new.actor_name := 'کارمند';
  end if;
  return new;
end;
$$;
revoke all on function public.set_file_manager_document_report_actor() from public, anon, authenticated;
drop trigger if exists set_file_manager_document_report_actor on public.file_manager_document_reports;
create trigger set_file_manager_document_report_actor
before insert on public.file_manager_document_reports
for each row execute function public.set_file_manager_document_report_actor();
