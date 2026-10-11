begin;

-- A daily-report destination can also be the two-way bridge for its linked internal channel.
-- Keep its existing purpose so the report scheduler continues to target it.

create or replace function public.messenger_auto_link_daily_report_chat()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $function$
declare
  v_platform text;
  v_connection_name text;
  v_connection_creator uuid;
  v_connection_enabled boolean;
  v_creator uuid;
  v_conversation_id uuid;
  v_title text;
begin
  if new.conversation_id is not null
     or new.enabled is not true
     or new.purpose <> 'daily_report' then
    return new;
  end if;

  select c.platform, c.display_name, c.created_by, c.enabled
    into v_platform, v_connection_name, v_connection_creator, v_connection_enabled
  from public.messenger_connections c
  where c.id = new.connection_id
    and c.organization_id = new.organization_id;

  if not found
     or v_connection_enabled is not true
     or v_platform not in ('telegram','bale','whatsapp') then
    return new;
  end if;

  select p.id into v_creator
  from public.profiles p
  where p.organization_id = new.organization_id
    and p.is_active = true
    and p.role::text in ('owner','admin')
  order by (p.id = v_connection_creator) desc, p.created_at asc, p.id
  limit 1;

  if v_creator is null then
    raise exception 'ACTIVE_INTERNAL_CREATOR_REQUIRED_FOR_MESSENGER_BRIDGE';
  end if;

  v_title := left(
    (case v_platform when 'telegram' then 'تلگرام'
                     when 'whatsapp' then 'واتساپ'
                     when 'bale' then 'بله'
                     else 'پیام‌رسان' end)
    || ' · ' || coalesce(nullif(trim(v_connection_name),''),'Customs OS'),
    120
  );

  insert into public.chat_conversations(
    organization_id, type, title, created_by
  ) values (
    new.organization_id, 'company_channel', v_title, v_creator
  )
  returning id into v_conversation_id;

  insert into public.chat_conversation_members(
    organization_id, conversation_id, user_id, role
  )
  select
    p.organization_id,
    v_conversation_id,
    p.id,
    case
      when p.id = v_creator then 'owner'
      when p.role::text in ('owner','admin') then 'admin'
      else 'member'
    end
  from public.profiles p
  where p.organization_id = new.organization_id
    and p.is_active = true
    and p.role::text <> 'client'
  on conflict do nothing;

  update public.messenger_chats
     set conversation_id = v_conversation_id
   where id = new.id
     and organization_id = new.organization_id
     and conversation_id is null;

  return new;
end
$function$;

revoke all on function public.messenger_auto_link_daily_report_chat() from public, anon, authenticated;

drop trigger if exists trg_messenger_auto_link_daily_report_insert on public.messenger_chats;
create trigger trg_messenger_auto_link_daily_report_insert
after insert on public.messenger_chats
for each row execute function public.messenger_auto_link_daily_report_chat();

drop trigger if exists trg_messenger_auto_link_daily_report_update on public.messenger_chats;
create trigger trg_messenger_auto_link_daily_report_update
after update of purpose, enabled, conversation_id on public.messenger_chats
for each row execute function public.messenger_auto_link_daily_report_chat();

-- Outgoing replies from the linked Customs OS conversation should go back to the
-- same external chat regardless of whether that mapping also receives daily reports.
create or replace function public.messenger_enqueue_chat_delivery()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $function$
begin
  if new.sender_id is null
     or new.message_type <> 'text'
     or new.external_platform is not null then
    return new;
  end if;

  insert into public.messenger_delivery_outbox(
    organization_id, connection_id, messenger_chat_id, chat_message_id,
    external_chat_id, status, next_attempt_at
  )
  select
    mc.organization_id, mc.connection_id, mc.id, new.id,
    mc.external_chat_id, 'queued', now()
  from public.messenger_chats mc
  join public.messenger_connections conn
    on conn.id = mc.connection_id
   and conn.organization_id = mc.organization_id
   and conn.enabled = true
  where mc.organization_id = new.organization_id
    and mc.conversation_id = new.conversation_id
    and mc.enabled = true
  on conflict(messenger_chat_id, chat_message_id) do nothing;

  return new;
end
$function$;

revoke all on function public.messenger_enqueue_chat_delivery() from public, anon, authenticated;

-- Link any existing daily-report destinations. The trigger creates an internal
-- company channel and grants access only to active non-client members of that org.
update public.messenger_chats mc
set purpose = mc.purpose
from public.messenger_connections c
where c.id = mc.connection_id
  and c.organization_id = mc.organization_id
  and c.platform in ('telegram','bale','whatsapp')
  and c.enabled = true
  and mc.enabled = true
  and mc.purpose = 'daily_report'
  and mc.conversation_id is null;

-- Mirror inbound events already captured by the webhook into the new internal chat.
do $backfill$
declare
  v_log record;
  v_body text;
  v_message_id uuid;
  v_message_type text;
begin
  for v_log in
    select ml.id, ml.organization_id, ml.connection_id, ml.external_chat_id,
           ml.external_message_id, ml.message_type, ml.payload_summary, ml.created_at,
           c.platform, mc.conversation_id
    from public.message_logs ml
    join public.messenger_connections c
      on c.id = ml.connection_id and c.organization_id = ml.organization_id
    join public.messenger_chats mc
      on mc.connection_id = ml.connection_id
     and mc.organization_id = ml.organization_id
     and mc.external_chat_id = ml.external_chat_id
    where ml.direction = 'inbound'
      and ml.chat_message_id is null
      and ml.external_message_id is not null
      and mc.conversation_id is not null
    order by ml.created_at, ml.id
  loop
    v_body := nullif(trim(coalesce(v_log.payload_summary->>'text','')), '');
    if v_body is null and v_log.message_type = 'document' then
      v_body := '📎 فایل دریافتی: ' || coalesce(nullif(v_log.payload_summary->>'name',''),'سند');
    end if;
    if v_body is null then
      continue;
    end if;

    v_message_type := case
      when v_log.message_type = 'document'
       and lower(coalesce(v_log.payload_summary->>'mimeType','')) like 'audio/%' then 'voice'
      when v_log.message_type = 'document' then 'file'
      else 'text'
    end;

    v_message_id := null;
    insert into public.chat_messages(
      organization_id, conversation_id, sender_id, client_uuid,
      message_type, body, delivery_status, external_platform,
      external_connection_id, external_chat_id, external_message_id,
      external_sender_id, external_sender_name, created_at, updated_at
    ) values (
      v_log.organization_id, v_log.conversation_id, null, gen_random_uuid(),
      v_message_type, v_body, 'sent', v_log.platform,
      v_log.connection_id, v_log.external_chat_id, v_log.external_message_id,
      nullif(v_log.payload_summary->>'externalUserId',''),
      nullif(left(trim(coalesce(v_log.payload_summary->>'senderName','')),160),''),
      v_log.created_at, v_log.created_at
    )
    on conflict do nothing
    returning id into v_message_id;

    if v_message_id is null then
      select m.id into v_message_id
      from public.chat_messages m
      where m.external_connection_id = v_log.connection_id
        and m.external_chat_id = v_log.external_chat_id
        and m.external_message_id = v_log.external_message_id
      limit 1;
    end if;

    if v_message_id is not null then
      update public.message_logs
      set chat_message_id = v_message_id
      where id = v_log.id and chat_message_id is null;
    end if;
  end loop;
end
$backfill$;

commit;
