-- Owner Console integrity: audit organization root changes without changing existing role access.
create or replace function public.record_organization_audit()
returns trigger
language plpgsql
security definer
set search_path=public,pg_catalog,pg_temp
as $$
begin
  if tg_op='DELETE' then
    insert into public.audit_logs(organization_id,user_id,action,table_name,record_id,old_data,new_data)
    values(old.id,auth.uid(),tg_op,'organizations',old.id,to_jsonb(old),null);
  elsif tg_op='UPDATE' then
    insert into public.audit_logs(organization_id,user_id,action,table_name,record_id,old_data,new_data)
    values(new.id,auth.uid(),tg_op,'organizations',new.id,to_jsonb(old),to_jsonb(new));
  elsif tg_op='INSERT' then
    insert into public.audit_logs(organization_id,user_id,action,table_name,record_id,old_data,new_data)
    values(new.id,auth.uid(),tg_op,'organizations',new.id,null,to_jsonb(new));
  end if;
  return coalesce(new,old);
end;
$$;

drop trigger if exists tr_owner_organization_audit on public.organizations;
create trigger tr_owner_organization_audit
after insert or update or delete on public.organizations
for each row execute function public.record_organization_audit();

-- Owner-only Console API has no create/delete path for organizations; root changes are update-only.
