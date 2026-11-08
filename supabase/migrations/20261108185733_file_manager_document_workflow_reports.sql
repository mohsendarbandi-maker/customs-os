-- Append-only employee status and report history for each archived document.
create table if not exists public.file_manager_document_reports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  file_id uuid not null references public.file_manager_files(id) on delete restrict,
  status text not null default 'in_review'
    check (status in ('received','in_review','action_required','completed','blocked','archived')),
  stage text not null default '',
  report text not null check (char_length(btrim(report)) between 1 and 4000),
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);
create index if not exists file_manager_document_reports_file_created_idx
  on public.file_manager_document_reports (organization_id, file_id, created_at desc);
alter table public.file_manager_document_reports enable row level security;
revoke all on public.file_manager_document_reports from anon, authenticated;
grant select, insert on public.file_manager_document_reports to authenticated;
drop policy if exists file_manager_document_reports_select on public.file_manager_document_reports;
create policy file_manager_document_reports_select
on public.file_manager_document_reports for select to authenticated
using (
  organization_id = public.user_org_id()
  and exists (select 1 from public.file_manager_files f
    where f.id = file_manager_document_reports.file_id
      and f.organization_id = file_manager_document_reports.organization_id)
);
drop policy if exists file_manager_document_reports_insert on public.file_manager_document_reports;
create policy file_manager_document_reports_insert
on public.file_manager_document_reports for insert to authenticated
with check (
  organization_id = public.user_org_id()
  and created_by = auth.uid()
  and (select public.user_role())::text = any(array['owner','admin','broker','accountant','warehouse'])
  and exists (select 1 from public.file_manager_files f
    where f.id = file_manager_document_reports.file_id
      and f.organization_id = file_manager_document_reports.organization_id
      and f.is_archived = false)
);
