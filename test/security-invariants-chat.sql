-- Scenario SQL for Supabase SQL Editor.
-- This script creates no permanent test data. It checks structural invariants and uses RLS policies
-- against the authenticated role with request.jwt.claim.sub where the project permits role simulation.

select tablename, rowsecurity
from pg_tables
where schemaname='public'
  and tablename in (
    'chat_conversations','chat_conversation_members','chat_messages',
    'chat_message_user_states','chat_message_reactions','chat_message_mentions',
    'chat_message_pins','chat_message_receipts','chat_attachments',
    'file_scans','notification_outbox','chat_user_focus'
  )
order by tablename;

select policyname,tablename,cmd
from pg_policies
where schemaname='public'
  and tablename like 'chat_%'
order by tablename,policyname;

select indexname,tablename
from pg_indexes
where schemaname='public'
  and tablename like 'chat_%'
order by tablename,indexname;

select n.nspname as schema_name,p.proname,pg_get_function_identity_arguments(p.oid) as args,p.prosecdef
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public'
  and p.proname like 'chat_%'
order by p.proname;