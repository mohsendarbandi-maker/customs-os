-- Harden chat voice notifications and background call wake-up.
create unique index if not exists notification_outbox_voice_call_unique
  on public.notification_outbox (user_id, tag)
  where tag like 'voice-call-%';

create or replace function public.chat_voice_call_realtime()
returns trigger
security definer
set search_path = public, net, vault, pg_catalog, pg_temp
language plpgsql
as $function$
declare
  v_caller_name text;
  v_push_secret text;
  p jsonb;
begin
  select p.full_name
    into v_caller_name
  from public.profiles p
  where p.id = new.caller_id;

  p := jsonb_build_object(
    'call_id', new.id,
    'organization_id', new.organization_id,
    'conversation_id', new.conversation_id,
    'caller_name', coalesce(v_caller_name, 'همکار'),
    'caller_id', new.caller_id,
    'callee_id', new.callee_id,
    'status', new.status,
    'answered_at', new.answered_at,
    'ended_at', new.ended_at
  );

  if tg_op = 'INSERT' then
    perform realtime.send(p, 'voice_invite', 'chat-voice-user:' || new.callee_id::text, true);

    insert into public.notification_outbox (
      organization_id, user_id, conversation_id, message_id,
      tag, title, body, url, payload
    )
    values (
      new.organization_id,
      new.callee_id,
      new.conversation_id,
      null,
      'voice-call-' || new.id::text,
      'تماس صوتی از ' || coalesce(v_caller_name, 'همکار'),
      'یک تماس صوتی ورودی دارید.',
      '/chat?conversation=' || new.conversation_id::text || '&call=' || new.id::text,
      jsonb_build_object(
        'kind', 'voice_call',
        'callId', new.id,
        'conversationId', new.conversation_id
      )
    )
    on conflict (user_id, tag) where tag like 'voice-call-%' do nothing;

    v_push_secret := public.internal_get_reminder_secret('chat_push_cron_secret');
    if v_push_secret is not null then
      perform net.http_post(
        'https://bjngfgiecvihofemptub.supabase.co/functions/v1/send-chat-push',
        '{}'::jsonb,
        '{}'::jsonb,
        jsonb_build_object(
          'Content-Type', 'application/json',
          'x-chat-push-cron-secret', v_push_secret
        ),
        10000
      );
    end if;
  elsif tg_op = 'UPDATE' and old.status is distinct from new.status then
    perform realtime.send(
      p,
      'voice_status',
      'chat-voice-user:' || new.caller_id::text,
      true
    );
    if new.callee_id is distinct from new.caller_id then
      perform realtime.send(
        p,
        'voice_status',
        'chat-voice-user:' || new.callee_id::text,
        true
      );
    end if;
  end if;

  return new;
end;
$function$;

revoke all on function public.chat_voice_call_realtime() from public, anon, authenticated;
