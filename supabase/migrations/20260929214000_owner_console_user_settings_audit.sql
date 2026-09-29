-- Owner Console: audit user_settings mutations because the table is user-keyed, not organization-keyed.
create or replace function public.record_user_settings_audit()
returns trigger
language plpgsql
security definer
set search_path=public,pg_catalog,pg_temp
as $$
declare v_org uuid:=public.user_org_id(); v_id uuid;
begin
  v_id:=case when tg_op='DELETE' then old.user_id else new.user_id end;
  insert into public.audit_logs(organization_id,user_id,action,table_name,record_id,old_data,new_data)
  values(v_org,auth.uid(),tg_op,'user_settings',v_id,
         case when tg_op='DELETE' or tg_op='UPDATE' then to_jsonb(old) else null end,
         case when tg_op='INSERT' or tg_op='UPDATE' then to_jsonb(new) else null end);
  return coalesce(new,old);
end;
$$;

drop trigger if exists tr_owner_user_settings_audit on public.user_settings;
create trigger tr_owner_user_settings_audit
after insert or update or delete on public.user_settings
for each row execute function public.record_user_settings_audit();
