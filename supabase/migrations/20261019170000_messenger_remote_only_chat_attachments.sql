-- Chat attachments reference files hosted by a connected messenger.
-- New browser uploads are sent to the configured Telegram file archive and never
-- persisted as new objects in the chat-files Storage bucket. Existing objects remain
-- available for continuity and are not deleted by this migration.

alter table public.chat_attachments
  alter column storage_path drop not null,
  alter column size_bytes drop not null;

alter table public.chat_attachments
  add column if not exists file_asset_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.chat_attachments'::regclass
      and conname = 'chat_attachments_file_asset_id_fkey'
  ) then
    alter table public.chat_attachments
      add constraint chat_attachments_file_asset_id_fkey
      foreign key (file_asset_id) references public.file_assets(id) on delete restrict;
  end if;
end
$$;

alter table public.chat_attachments
  drop constraint if exists chat_attachments_security_status_check,
  drop constraint if exists chat_attachments_size_bytes_check,
  drop constraint if exists chat_attachments_storage_reference_check;

alter table public.chat_attachments
  add constraint chat_attachments_security_status_check
    check (security_status = any (array['scanning'::text, 'clean'::text, 'blocked'::text])),
  add constraint chat_attachments_size_bytes_check
    check (
      (
        storage_path is not null
        and size_bytes is not null
        and size_bytes > 0
        and size_bytes <= 52428800
      )
      or
      (
        storage_path is null
        and file_asset_id is not null
        and (
          size_bytes is null
          or (size_bytes > 0 and size_bytes <= 2147483648)
        )
      )
    ),
  add constraint chat_attachments_storage_reference_check
    check (
      (storage_path is not null and file_asset_id is null)
      or (storage_path is null and file_asset_id is not null)
    );

create index if not exists chat_attachments_file_asset_id_idx
  on public.chat_attachments (organization_id, file_asset_id)
  where file_asset_id is not null;

-- Prevent stale browser bundles from continuing to write new binary objects.
-- Service-role scanner operations and reads of existing files are unaffected.
drop policy if exists chat_files_insert_quarantine on storage.objects;
