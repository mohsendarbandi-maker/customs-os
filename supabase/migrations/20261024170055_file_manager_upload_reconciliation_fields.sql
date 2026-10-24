-- Persist the Telegram receipt before saving dependent metadata so interrupted uploads
-- can be reconciled without sending the same file to Telegram a second time.
alter table public.file_manager_upload_jobs
  add column if not exists connection_id uuid null,
  add column if not exists external_chat_id text null,
  add column if not exists document_name text null,
  add column if not exists document_type text null,
  add column if not exists telegram_file_id text null,
  add column if not exists telegram_file_unique_id text null,
  add column if not exists archive_tags text[] not null default '{}'::text[];

comment on column public.file_manager_upload_jobs.telegram_file_id is
  'Telegram file_id receipt persisted before metadata writes; used only for safe archive reconciliation, never for re-upload.';
comment on column public.file_manager_upload_jobs.status is
  'uploading, stored, failed, or reconcile_required; jobs with Telegram receipts are reconciled without re-sending bytes.';

