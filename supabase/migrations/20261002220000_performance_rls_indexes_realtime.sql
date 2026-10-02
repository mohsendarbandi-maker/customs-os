-- Performance/RLS/RealtIme baseline applied to project bjngfgiecvihofemptub.
-- Idempotent: policy rewrites use ALTER POLICY, indexes use IF NOT EXISTS, publication
-- additions ignore duplicate_object. A private backup plus rollback function is retained.
create schema if not exists private;
create table if not exists private.rls_policy_optimization_backup_20261002(
 schema_name text not null,table_name text not null,policy_name text not null,
 permissive boolean not null,command text not null,roles text[] not null,using_expr text,check_expr text,
 primary key(schema_name,table_name,policy_name)
);

do $$ declare r record;q text;w text;
begin
 for r in select n.nspname schema_name,c.relname table_name,p.polname policy_name,
   pg_get_expr(p.polqual,p.polrelid) qual,pg_get_expr(p.polwithcheck,p.polrelid) chk
 from pg_policy p join pg_class c on c.oid=p.polrelid join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relname in(
 'chat_messages','chat_message_receipts','chat_message_user_states','chat_user_focus',
 'operational_reminders','push_subscriptions','notification_preferences','reminder_deliveries','ai_operator_commands')
 loop
  q:=r.qual;w:=r.chk;
  if q is not null then
   q:=replace(q,'(select auth.uid())','auth.uid()');q:=replace(q,'(select user_org_id())','user_org_id()');q:=replace(q,'(select user_role())','user_role()');q:=replace(q,'(select user_client_id())','user_client_id()');
   q:=replace(q,'auth.uid()','(select auth.uid())');q:=replace(q,'user_org_id()','(select user_org_id())');q:=replace(q,'user_role()','(select user_role())');q:=replace(q,'user_client_id()','(select user_client_id())');
  end if;
  if w is not null then
   w:=replace(w,'(select auth.uid())','auth.uid()');w:=replace(w,'(select user_org_id())','user_org_id()');w:=replace(w,'(select user_role())','user_role()');w:=replace(w,'(select user_client_id())','user_client_id()');
   w:=replace(w,'auth.uid()','(select auth.uid())');w:=replace(w,'user_org_id()','(select user_org_id())');w:=replace(w,'user_role()','(select user_role())');w:=replace(w,'user_client_id()','(select user_client_id())');
  end if;
  execute format('alter policy %I on %I.%I%s%s',r.policy_name,r.schema_name,r.table_name,
   case when q is not null then ' using ('||q||')' else '' end,
   case when w is not null then ' with check ('||w||')' else '' end);
 end loop;
end $$;

do $$ declare r record;idx text;cols text;
begin
 for r in
  select n.nspname schema_name,c.relname table_name,con.conname,array_agg(a.attname order by k.ord) cols_arr
  from pg_constraint con join pg_class c on c.oid=con.conrelid join pg_namespace n on n.oid=c.relnamespace
  join lateral unnest(con.conkey) with ordinality k(attnum,ord) on true join pg_attribute a on a.attrelid=c.oid and a.attnum=k.attnum
  where con.contype='f' and n.nspname='public'
  and not exists(select 1 from pg_index i where i.indrelid=con.conrelid and i.indpred is null and i.indexprs is null
   and (select array_agg(x.attnum order by x.ord) from unnest(i.indkey) with ordinality x(attnum,ord) where x.ord<=array_length(con.conkey,1))=con.conkey)
  group by n.nspname,c.relname,con.conname
 loop
  cols:=array_to_string(r.cols_arr,', ');idx:='idx_fk_'||substr(md5(r.schema_name||'.'||r.table_name||'.'||r.conname),1,18);
  execute format('create index if not exists %I on %I.%I (%s)',idx,r.schema_name,r.table_name,cols);
 end loop;
end $$;

alter function public.user_org_id() stable;
alter function public.user_role() stable;
alter function public.user_client_id() stable;

do $$ begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
  begin alter publication supabase_realtime add table public.chat_messages; exception when duplicate_object then null;end;
  begin alter publication supabase_realtime add table public.chat_message_receipts; exception when duplicate_object then null;end;
  begin alter publication supabase_realtime add table public.chat_message_reactions; exception when duplicate_object then null;end;
  begin alter publication supabase_realtime add table public.chat_conversation_members; exception when duplicate_object then null;end;
 end if;
end $$;

create or replace function private.rollback_rls_optimization_20261002()
returns void language plpgsql security definer set search_path=private,public,pg_catalog as $$
declare r record;
begin
 for r in select * from private.rls_policy_optimization_backup_20261002 order by schema_name,table_name,policy_name loop
  if not exists(select 1 from pg_policy p join pg_class c on c.oid=p.polrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname=r.schema_name and c.relname=r.table_name and p.polname=r.policy_name::name) then
   execute format('create policy %I on %I.%I as %s for %s to %s%s%s',r.policy_name,r.schema_name,r.table_name,
    case when r.permissive then 'permissive' else 'restrictive' end,r.command,
    case when r.roles='{PUBLIC}' then 'PUBLIC' else array_to_string(array(select quote_ident(x) from unnest(r.roles)x),', ') end,
    case when r.using_expr is not null then ' using ('||r.using_expr||')' else '' end,
    case when r.check_expr is not null then ' with check ('||r.check_expr||')' else '' end);
  end if;
 end loop;
end $$;
revoke all on function private.rollback_rls_optimization_20261002() from public,anon,authenticated;
