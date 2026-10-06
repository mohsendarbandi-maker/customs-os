-- Enterprise messenger delivery/realtime hardening.
-- Reuses existing chat tables and adds only the missing recipient-device/playback
-- signal plus a per-user inbox fanout topic for scalable inactive-conversation updates.

ALTER TABLE public.chat_message_receipts
  ADD COLUMN IF NOT EXISTS played_at timestamptz;

CREATE OR REPLACE FUNCTION public.chat_mark_played(p_message_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_catalog','pg_temp'
AS $function$
declare
  v_user uuid := auth.uid();
  v_org uuid;
  v_conversation uuid;
begin
  if v_user is null then
    raise exception 'احراز هویت الزامی است';
  end if;

  select m.organization_id, m.conversation_id
    into v_org, v_conversation
  from public.chat_messages m
  where m.id = p_message_id
    and m.message_type = 'voice'
    and m.deleted_at is null;

  if v_conversation is null or not public.chat_user_is_member(v_conversation) then
    raise exception 'پیام صوتی در دسترس نیست';
  end if;

  insert into public.chat_message_receipts(
    organization_id,message_id,user_id,status,delivered_at,read_at,played_at
  )
  values(v_org,p_message_id,v_user,'delivered',now(),null,now())
  on conflict(message_id,user_id) do update
    set status=case
      when public.chat_message_receipts.status='read' then 'read'
      else 'delivered'
    end,
    delivered_at=coalesce(public.chat_message_receipts.delivered_at,now()),
    played_at=coalesce(public.chat_message_receipts.played_at,now()),
    updated_at=now();
end;
$function$;

REVOKE ALL ON FUNCTION public.chat_mark_played(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.chat_mark_played(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.chat_broadcast_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_catalog','pg_temp'
AS $function$
declare
  v_user_id uuid;
  v_event text := case when TG_OP='INSERT' then 'message:new' else 'message:update' end;
  v_payload jsonb := jsonb_build_object('record',to_jsonb(NEW));
begin
  perform realtime.send(
    v_payload,
    v_event,
    'chat:' || NEW.conversation_id::text,
    true
  );

  for v_user_id in
    select m.user_id
    from public.chat_conversation_members m
    where m.conversation_id=NEW.conversation_id
      and m.deleted_at is null
      and m.left_at is null
      and m.user_id is not null
  loop
    perform realtime.send(
      v_payload,
      v_event,
      'chat-inbox-user:' || v_user_id::text,
      true
    );
  end loop;

  return NEW;
end;
$function$;

CREATE OR REPLACE FUNCTION public.chat_broadcast_receipt()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_catalog','pg_temp'
AS $function$
declare
  v_conversation_id uuid;
  v_user_id uuid;
  v_payload jsonb := jsonb_build_object('record',to_jsonb(NEW));
begin
  select m.conversation_id
    into v_conversation_id
  from public.chat_messages m
  where m.id=NEW.message_id;

  if v_conversation_id is null then
    return NEW;
  end if;

  perform realtime.send(
    v_payload,
    'receipt:change',
    'chat:' || v_conversation_id::text,
    true
  );

  for v_user_id in
    select m.user_id
    from public.chat_conversation_members m
    where m.conversation_id=v_conversation_id
      and m.deleted_at is null
      and m.left_at is null
      and m.user_id is not null
  loop
    perform realtime.send(
      v_payload,
      'receipt:change',
      'chat-inbox-user:' || v_user_id::text,
      true
    );
  end loop;

  return NEW;
end;
$function$;

DO $policy$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname='realtime'
      AND tablename='messages'
      AND policyname='chat_realtime_inbox_select'
  ) THEN
    CREATE POLICY chat_realtime_inbox_select
      ON realtime.messages
      FOR SELECT
      TO authenticated
      USING (
        realtime.topic() = ('chat-inbox-user:' || (SELECT auth.uid())::text)
        AND extension = 'broadcast'
      );
  END IF;
END
$policy$;

REVOKE ALL ON FUNCTION public.chat_broadcast_message() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.chat_broadcast_receipt() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.chat_broadcast_message() TO authenticated;
GRANT EXECUTE ON FUNCTION public.chat_broadcast_receipt() TO authenticated;
