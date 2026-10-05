create or replace function public.claim_chat_notification_outbox(p_limit integer default 100)
returns setof public.notification_outbox language plpgsql security definer set search_path=public,pg_catalog as $$
begin return query with claimed as(
 select id from public.notification_outbox where sent_at is null and coalesce(next_attempt_at,scheduled_at,created_at)<=now() and attempts<8 order by coalesce(scheduled_at,created_at),created_at for update skip locked limit greatest(1,least(p_limit,500)))
 update public.notification_outbox o set attempts=o.attempts+1,next_attempt_at=now()+interval '5 minutes' from claimed where o.id=claimed.id returning o.*;end $$;
revoke all on function public.claim_chat_notification_outbox(integer) from public,anon,authenticated;
grant execute on function public.claim_chat_notification_outbox(integer) to service_role;
do $$ begin if not exists(select 1 from vault.secrets where name='chat_push_cron_secret') then perform vault.create_secret(encode(gen_random_bytes(32),'hex'),'chat_push_cron_secret','Internal cron secret for send-chat-push');end if;end $$;
select cron.schedule('send-chat-push-every-minute','* * * * *',$job$select net.http_post(url:='https://bjngfgiecvihofemptub.supabase.co/functions/v1/send-chat-push',headers:=jsonb_build_object('Content-Type','application/json','x-chat-push-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='chat_push_cron_secret')),body:='{"mode":"cron"}'::jsonb,timeout_milliseconds:=10000);$job$);
