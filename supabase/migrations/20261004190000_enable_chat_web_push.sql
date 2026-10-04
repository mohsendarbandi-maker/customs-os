-- Expose only the public VAPID key to authenticated clients.
create or replace function public.get_push_vapid_public_key()
returns text
language sql
stable
security definer
set search_path to 'vault','public','pg_catalog','pg_temp'
as $function$
  select case
    when auth.uid() is null then null
    else (
      select decrypted_secret
      from vault.decrypted_secrets
      where name='reminder_vapid_public'
      limit 1
    )
  end;
$function$;

revoke execute on function public.get_push_vapid_public_key() from public, anon;
grant execute on function public.get_push_vapid_public_key() to authenticated;

-- Internal secret access must never be exposed to browser roles.
revoke execute on function public.internal_get_reminder_secret(text) from public, anon, authenticated;
grant execute on function public.internal_get_reminder_secret(text) to service_role;

-- Only signed-in users can register their own browser/device subscription.
revoke execute on function public.upsert_push_subscription(text,text,text,text,text) from public, anon;
grant execute on function public.upsert_push_subscription(text,text,text,text,text) to authenticated;

-- Queue chat notifications, then immediately wake the push sender.
create or replace function public.chat_enqueue_message_notifications()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'net', 'vault', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_push_secret text;
begin
  if NEW.message_type='system' or NEW.sender_id is null then
    return NEW;
  end if;

  insert into public.notification_outbox(
    organization_id,user_id,conversation_id,message_id,tag,title,body,url,payload
  )
  select
    p.organization_id,
    m.user_id,
    NEW.conversation_id,
    NEW.id,
    'chat-'||NEW.conversation_id::text,
    coalesce(c.title,'پیام جدید'),
    case when np.hide_content then null else left(coalesce(NEW.body,''),180) end,
    '/chat?conversation='||NEW.conversation_id::text,
    jsonb_build_object('conversationId',NEW.conversation_id,'messageId',NEW.id)
  from public.chat_conversation_members m
  join public.profiles p on p.id=m.user_id and p.is_active=true
  join public.chat_conversations c on c.id=NEW.conversation_id
  left join public.notification_preferences np on np.user_id=m.user_id
  where m.conversation_id=NEW.conversation_id
    and m.user_id<>NEW.sender_id
    and m.deleted_at is null
    and m.left_at is null
  on conflict(user_id,message_id) do nothing;

  v_push_secret := public.internal_get_reminder_secret('chat_push_cron_secret');

  if v_push_secret is not null then
    perform net.http_post(
      'https://bjngfgiecvihofemptub.supabase.co/functions/v1/send-chat-push',
      '{}'::jsonb,
      '{}'::jsonb,
      jsonb_build_object(
        'Content-Type','application/json',
        'x-chat-push-cron-secret',v_push_secret
      ),
      10000
    );
  end if;

  return NEW;
end;
$function$;

-- Trigger-only function; browser/API roles must not execute it directly.
revoke execute on function public.chat_enqueue_message_notifications() from public, anon, authenticated;
