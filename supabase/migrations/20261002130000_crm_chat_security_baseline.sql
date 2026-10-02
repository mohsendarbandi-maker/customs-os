begin;

do $$
declare v_count integer;
begin
  select count(*) into v_count
  from information_schema.tables
  where table_schema='public'
    and table_name in ('organizations','profiles','org_connections','chat_conversations','chat_conversation_members','chat_messages','chat_attachments','chat_message_receipts','chat_message_mentions','chat_message_reactions','chat_message_pins','chat_message_user_states','push_subscriptions','notification_outbox','operational_reminders');
  if v_count <> 15 then
    raise exception 'Customs OS security baseline failed: expected 15 inspected tables, found %', v_count;
  end if;
end $$;

alter table public.org_connections enable row level security;
alter table public.chat_conversations enable row level security;
alter table public.chat_conversation_members enable row level security;
alter table public.chat_messages enable row level security;
alter table public.chat_attachments enable row level security;
alter table public.chat_message_receipts enable row level security;
alter table public.chat_message_mentions enable row level security;
alter table public.chat_message_reactions enable row level security;
alter table public.chat_message_pins enable row level security;
alter table public.chat_message_user_states enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.notification_outbox enable row level security;

drop policy if exists chat_messages_select on public.chat_messages;
create policy chat_messages_select
on public.chat_messages for select to authenticated
using (
  deleted_at is null
  and public.chat_user_is_member(conversation_id)
  and not exists (
    select 1 from public.chat_message_user_states s
    where s.message_id = chat_messages.id
      and s.user_id = auth.uid()
      and s.deleted_at is not null
  )
);

drop trigger if exists trg_chat_members_audit on public.chat_conversation_members;
create trigger trg_chat_members_audit
after insert or update or delete on public.chat_conversation_members
for each row execute function public.record_audit_event();

drop trigger if exists trg_chat_members_guest on public.chat_conversation_members;
create trigger trg_chat_members_guest
before insert or update or delete on public.chat_conversation_members
for each row execute function public.block_audit_guest_writes();

drop policy if exists chat_members_insert on public.chat_conversation_members;
create policy chat_members_insert on public.chat_conversation_members
for insert to authenticated with check (false);

drop policy if exists chat_members_update on public.chat_conversation_members;
create policy chat_members_update on public.chat_conversation_members
for update to authenticated using (false) with check (false);

drop policy if exists chat_members_delete on public.chat_conversation_members;
create policy chat_members_delete on public.chat_conversation_members
for delete to authenticated using (false);

revoke execute on function public.chat_user_is_member(uuid,uuid) from public, anon;
grant execute on function public.chat_user_is_member(uuid,uuid) to authenticated;
revoke execute on function public.chat_can_manage(uuid) from public, anon;
grant execute on function public.chat_can_manage(uuid) to authenticated;
revoke execute on function public.chat_create_conversation(text,text,text,uuid,uuid,uuid,uuid) from public, anon;
grant execute on function public.chat_create_conversation(text,text,text,uuid,uuid,uuid,uuid) to authenticated;
revoke execute on function public.chat_add_member(uuid,uuid,text) from public, anon;
grant execute on function public.chat_add_member(uuid,uuid,text) to authenticated;
revoke execute on function public.chat_insert_message(uuid,uuid,text,text,uuid,uuid,uuid) from public, anon;
grant execute on function public.chat_insert_message(uuid,uuid,text,text,uuid,uuid,uuid) to authenticated;
revoke execute on function public.chat_delete_message_for_me(uuid) from public, anon;
grant execute on function public.chat_delete_message_for_me(uuid) to authenticated;
revoke execute on function public.chat_delete_message_for_all(uuid) from public, anon;
grant execute on function public.chat_delete_message_for_all(uuid) to authenticated;
revoke execute on function public.chat_mark_read(uuid,uuid) from public, anon;
grant execute on function public.chat_mark_read(uuid,uuid) to authenticated;
revoke execute on function public.chat_mark_delivered(uuid) from public, anon;
grant execute on function public.chat_mark_delivered(uuid) to authenticated;
revoke execute on function public.upsert_push_subscription(text,text,text,text,text) from public, anon;
grant execute on function public.upsert_push_subscription(text,text,text,text,text) to authenticated;

create index if not exists chat_messages_org_conversation_idx
on public.chat_messages (organization_id, conversation_id, created_at desc, id desc);

create index if not exists chat_members_org_user_idx
on public.chat_conversation_members (organization_id, user_id, deleted_at, conversation_id);

create index if not exists chat_message_states_message_user_deleted_idx
on public.chat_message_user_states (message_id, user_id, deleted_at);

commit;
