drop policy if exists file_manager_document_reports_select on public.file_manager_document_reports;
create policy file_manager_document_reports_select
on public.file_manager_document_reports
for select to authenticated
using (
  organization_id = public.user_org_id()
  and (select public.user_role())::text = any(array['owner','admin','broker','accountant','warehouse'])
  and exists (
    select 1 from public.file_manager_files f
    where f.id = file_manager_document_reports.file_id
      and f.organization_id = file_manager_document_reports.organization_id
  )
);
