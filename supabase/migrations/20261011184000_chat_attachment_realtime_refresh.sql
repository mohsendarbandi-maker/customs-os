begin;

create or replace function public.chat_broadcast_attachment_update()
returns trigger
language plpgsql
security definer
set search_path = public, realtime, pg_catalog, pg_temp
as $function$
declare
  v_message public.chat_messages%rowtype;
begin
  select m.*
    into v_message
  from public.chat_messages m
  where m.id=new.message_id
    and m.conversation_id=new.conversation_id
    and m.organization_id=new.organization_id
    and m.deleted_at is null;

  if not found then
    return new;
  end if;

  perform realtime.send(
    jsonb_build_object('record',to_jsonb(v_message)),
    'attachment:update',
    'chat:' || v_message.conversation_id::text,
    true
  );

  return new;
end;
$function$;

revoke all on function public.chat_broadcast_attachment_update() from public, anon, authenticated;
drop trigger if exists trg_chat_attachment_realtime_update on public.chat_attachments;
create trigger trg_chat_attachment_realtime_update
after insert or update of storage_path, original_name, mime_type, size_bytes,
  security_status, security_checked_at, security_error
on public.chat_attachments
for each row execute function public.chat_broadcast_attachment_update();

commit;