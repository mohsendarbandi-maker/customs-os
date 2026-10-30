begin;

alter table public.file_manager_upload_jobs
  add column if not exists shipment_document_id uuid
    references public.shipment_documents(id) on delete set null;

create index if not exists file_manager_upload_jobs_shipment_document_id_idx
  on public.file_manager_upload_jobs(shipment_document_id)
  where shipment_document_id is not null;

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
        timeout_milliseconds := 20000
      )
      from (
        select distinct f.organization_id
        from public.file_manager_files f
        where f.is_archived = false
          and f.file_asset_id is null
          and f.storage_path is not null
          and f.metadata->>'legacyStorageBackend' = 'supabase'
        order by f.organization_id
        limit 50
      ) as pending;
    $job$
  );
end;
$do$;

commit;
