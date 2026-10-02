do $$ begin
 drop policy if exists chat_realtime_select on realtime.messages;
 drop policy if exists chat_realtime_insert on realtime.messages;
end $$;
create policy chat_realtime_select on realtime.messages as permissive for select to authenticated
using(realtime.topic()~'^chat:[0-9a-fA-F-]{36}$' and exists(select 1 from public.chat_conversation_members m where m.conversation_id=(substring(realtime.topic() from 6))::uuid and m.user_id=(select auth.uid()) and m.deleted_at is null and m.left_at is null) and extension in('broadcast','presence'));
create policy chat_realtime_insert on realtime.messages as permissive for insert to authenticated
with check(realtime.topic()~'^chat:[0-9a-fA-F-]{36}$' and exists(select 1 from public.chat_conversation_members m where m.conversation_id=(substring(realtime.topic() from 6))::uuid and m.user_id=(select auth.uid()) and m.deleted_at is null and m.left_at is null) and extension in('broadcast','presence'));
