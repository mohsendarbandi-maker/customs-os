begin;

-- Temporary, private upload staging. Successful archive records still point to Telegram;
-- staged bytes are deleted when the Telegram receipt and canonical file record are saved.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('file-upload-staging', 'file-upload-staging', false, 52428800, null)
on conflict (id) do update
set public = false,
    file_size_limit = greatest(storage.buckets.file_size_limit, excluded.file_size_limit),
    allowed_mime_types = null;

alter table public.file_manager_upload_jobs
  add column if not exists staging_path text,
  add column if not exists telegram_call_started_at timestamptz;

drop policy if exists file_upload_staging_insert_org on storage.objects;
create policy file_upload_staging_insert_org
on storage.objects for insert to authenticated
with check (
  bucket_id = 'file-upload-staging'
  and split_part(name, '/', 1) = (select public.user_org_id())::text
  and (select public.user_role())::text in ('owner', 'admin', 'broker', 'accountant', 'warehouse', 'client')
);

drop policy if exists file_upload_staging_select_org on storage.objects;
create policy file_upload_staging_select_org
on storage.objects for select to authenticated
using (
  bucket_id = 'file-upload-staging'
  and split_part(name, '/', 1) = (select public.user_org_id())::text
  and (select public.user_role())::text in ('owner', 'admin', 'broker', 'accountant', 'warehouse', 'client')
);

drop policy if exists file_upload_staging_update_org on storage.objects;
create policy file_upload_staging_update_org
on storage.objects for update to authenticated
using (
  bucket_id = 'file-upload-staging'
  and split_part(name, '/', 1) = (select public.user_org_id())::text
  and (select public.user_role())::text in ('owner', 'admin', 'broker', 'accountant', 'warehouse', 'client')
)
with check (
  bucket_id = 'file-upload-staging'
  and split_part(name, '/', 1) = (select public.user_org_id())::text
  and (select public.user_role())::text in ('owner', 'admin', 'broker', 'accountant', 'warehouse', 'client')
);

drop policy if exists file_upload_staging_delete_org on storage.objects;
create policy file_upload_staging_delete_org
on storage.objects for delete to authenticated
using (
  bucket_id = 'file-upload-staging'
  and split_part(name, '/', 1) = (select public.user_org_id())::text
  and (select public.user_role())::text in ('owner', 'admin', 'broker', 'accountant', 'warehouse', 'client')
);

comment on column public.file_manager_upload_jobs.staging_path is
  'Private temporary Storage object used for resumable uploads; removed after Telegram archive completes.';
comment on column public.file_manager_upload_jobs.telegram_call_started_at is
  'Conservative marker preventing automatic resend when an earlier Telegram call may already have succeeded.';

commit;
