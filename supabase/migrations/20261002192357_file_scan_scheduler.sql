do $$ begin
 if not exists(select 1 from vault.secrets where name='file_scan_cron_secret') then
   perform vault.create_secret(encode(gen_random_bytes(32),'hex'),'file_scan_cron_secret','Internal cron secret for scan-chat-file');
 end if;
end $$;
select cron.schedule('scan-chat-files-every-minute','* * * * *',
 $job$
 select net.http_post(
   url := 'https://bjngfgiecvihofemptub.supabase.co/functions/v1/scan-chat-file',
   headers := jsonb_build_object('Content-Type','application/json','x-file-scan-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='file_scan_cron_secret')),
   body := '{"mode":"cron"}'::jsonb, timeout_milliseconds := 15000
 );
 $job$);