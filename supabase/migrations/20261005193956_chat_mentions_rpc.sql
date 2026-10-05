begin;

create or replace function public.chat_set_message_mentions(
  p_message_id uuid,
  p_user_ids uuid[]
)
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $function$
declare
  v_message public.chat_messages;
  v_inserted integer;
begin
  if auth.uid() is null then
    raise exception 'احراز هویت الزامی است';
  end if;

  select *
  into v_message
  from public.chat_messages
  where id=p_message_id
    and sender_id=auth.uid()
    and deleted_at is null;

  if not found then
    raise exception 'پیام برای mention در دسترس نیست';
  end if;

  delete from public.chat_message_mentions
  where message_id=p_message_id;

  insert into public.chat_message_mentions(
    organization_id,
    message_id,
    mentioned_user_id
  )
  select
    v_message.organization_id,
    p_message_id,
    p.id
  from public.profiles p
  join public.chat_conversation_members cm
    on cm.user_id=p.id
   and cm.conversation_id=v_message.conversation_id
   and cm.deleted_at is null
   and cm.left_at is null
  where p.is_active=true
    and p.organization_id=v_message.organization_id
    and p.id <> auth.uid()
    and p.id = any(coalesce(p_user_ids, array[]::uuid[]))
  on conflict do nothing;

  get diagnostics v_inserted = row_count;

  return v_inserted;
end;
$function$;

revoke all on function public.chat_set_message_mentions(uuid,uuid[]) from public,anon;
grant execute on function public.chat_set_message_mentions(uuid,uuid[]) to authenticated;

commit;