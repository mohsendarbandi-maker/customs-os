-- These tables are reached through RLS-scoped UI access or the service-role gateway.
-- Remove Supabase default table grants (including TRUNCATE/REFERENCES/TRIGGER) and grant only
-- the operations the authenticated UI actually needs.
revoke all on table public.file_manager_folders from public, anon, authenticated;
revoke all on table public.file_manager_files from public, anon, authenticated;
revoke all on table public.file_manager_upload_jobs from public, anon, authenticated;

grant select, insert, update on table public.file_manager_folders to authenticated;
grant select, update on table public.file_manager_files to authenticated;
grant all on table public.file_manager_folders, public.file_manager_files, public.file_manager_upload_jobs to service_role;
