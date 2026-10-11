begin;

create or replace function public.messenger_enqueue_chat_delivery()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
begin
  -- The delivery worker currently supports text only. Do not queue files,
  -- voice notes, or system events until their secure streaming path is enabled.
  if new.sender_id is null
     or new.message_type <> 'text'
     or new.external_platform is not null then
    return new;
  end if;

  insert into public.messenger_delivery_outbox(
    organization_id,connection_id,messenger_chat_id,chat_message_id,
    external_chat_id,status,next_attempt_at
  )
  select
    mc.organization_id,mc.connection_id,mc.id,new.id,mc.external_chat_id,'queued',now()
  from public.messenger_chats mc
  join public.messenger_connections conn
    on conn.id=mc.connection_id
   and conn.organization_id=mc.organization_id
   and conn.enabled=true
  where mc.organization_id=new.organization_id
    and mc.conversation_id=new.conversation_id
    and mc.enabled=true
    and mc.purpose='inbox'
  on conflict(messenger_chat_id,chat_message_id) do nothing;

  return new;
end;
$$;

revoke all on function public.messenger_enqueue_chat_delivery() from public, anon, authenticated;

commit;