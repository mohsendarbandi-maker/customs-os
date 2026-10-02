-- Security follow-up: semantic RLS names, anon privilege removal, trigger ACLs, duplicate index removal.
do $$ declare r record; new_name text;
begin
 for r in select schemaname,tablename,policyname,cmd from pg_policies where schemaname='public' and policyname like '__rls_opt_%' loop
  new_name=left(r.tablename||'_'||lower(r.cmd),55);
  if exists(select 1 from pg_policies where schemaname=r.schemaname and tablename=r.tablename and policyname=new_name and policyname<>r.policyname) then new_name=left(new_name,48)||'_'||substr(md5(r.policyname),1,8); end if;
  execute format('alter policy %I on %I.%I rename to %I',r.policyname,r.schemaname,r.tablename,new_name);
  execute format('alter policy %I on %I.%I to authenticated',new_name,r.schemaname,r.tablename);
 end loop;
end $$;
do $$ declare r record; begin
 for r in select table_schema,table_name from information_schema.tables where table_schema in('public','storage','realtime') loop
  execute format('revoke all on table %I.%I from anon',r.table_schema,r.table_name);
 end loop;
end $$;
revoke execute on function public.chat_guard_message_mutation() from public,anon,authenticated;
revoke execute on function public.record_global_reference_audit() from public,anon,authenticated;
revoke execute on function public.record_org_settings_audit() from public,anon,authenticated;
revoke execute on function public.record_organization_audit() from public,anon,authenticated;
revoke execute on function public.record_user_settings_audit() from public,anon,authenticated;
revoke execute on function public.chat_sync_delivery_status() from public,anon,authenticated;
revoke execute on function public.chat_enqueue_message_notifications() from public,anon,authenticated;
revoke execute on function public.ensure_financial_permission_row() from public,anon,authenticated;
revoke execute on function public.guard_org_connection_transition() from public,anon,authenticated;
drop index if exists public.idx_fk_178356d1f62e6c4fab;
create schema if not exists extensions;
alter extension pg_trgm set schema extensions;
-- pg_net cannot be moved with ALTER EXTENSION SET SCHEMA on the current Supabase build; retain it in public.
