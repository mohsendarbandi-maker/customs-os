CREATE OR REPLACE FUNCTION public.chat_unread_count(p_conversation_id uuid)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog', 'pg_temp'
AS $function$
  select count(*)
  from public.chat_messages m
  join public.chat_conversation_members me
    on me.conversation_id = m.conversation_id
   and me.user_id = auth.uid()
   and me.deleted_at is null
   and me.left_at is null
  left join public.chat_messages lm
    on lm.id = me.last_read_message_id
  where m.conversation_id = p_conversation_id
    and m.deleted_at is null
    and public.chat_user_is_member(p_conversation_id)
    and not exists (
      select 1
      from public.chat_message_user_states s
      where s.message_id = m.id
        and s.user_id = auth.uid()
        and s.deleted_at is not null
    )
    and (m.sender_id is null or m.sender_id <> auth.uid())
    and (
      lm.id is null
      or m.created_at > lm.created_at
      or (m.created_at = lm.created_at and m.id > lm.id)
    );
$function$;
