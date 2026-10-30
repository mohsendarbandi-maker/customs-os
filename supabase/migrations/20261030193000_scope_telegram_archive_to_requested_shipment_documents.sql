begin;

alter table public.shipment_documents
  add column if not exists telegram_archive_requested boolean not null default false;

create index if not exists shipment_documents_telegram_archive_queue_idx
  on public.shipment_documents (organization_id, created_at)
  where telegram_archive_requested = true
    and storage_backend = 'supabase'
    and file_asset_id is null
    and is_archived = false;

do $do$
declare
  existing_job record;
begin
  for existing_job in
    select jobid
    from cron.job
    where jobname = 'customs-os-shipment-document-telegram-archive-every-minute'
  loop
    perform cron.unschedule(existing_job.jobid);
  end loop;

  perform cron.schedule(
    'customs-os-shipment-document-telegram-archive-every-minute',
    '* * * * *',
    $job$
      select net.http_post(
        url := 'https://bjngfgiecvihofemptub.supabase.co/functions/v1/messenger-gateway',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-messenger-path', '/api/messenger/archive/legacy/process',
          'x-messenger-outbox-cron-secret',
            (select decrypted_secret
             from vault.decrypted_secrets
             where name = 'messenger_outbox_cron_secret'
             limit 1)
        ),
        body := jsonb_build_object(
          'organizationId', pending.organization_id::text,
          'limit', 3,
          'retryFailed', false
        ),
        timeout_milliseconds := 30000
      )
      from (
        select distinct sd.organization_id
        from public.shipment_documents sd
        join public.file_manager_files f
          on f.shipment_document_id = sd.id
         and f.organization_id = sd.organization_id
        where sd.telegram_archive_requested = true
          and sd.storage_backend = 'supabase'
          and sd.file_asset_id is null
          and not coalesce(sd.is_archived, false)
          and f.file_asset_id is null
          and not coalesce(f.is_archived, false)
          and f.metadata->>'legacyArchiveStatus' is distinct from 'failed'
        order by sd.organization_id
        limit 50
      ) as pending;
    $job$
  );
end;
$do$;

commit;
