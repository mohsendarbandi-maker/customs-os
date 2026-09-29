-- Owner Console access for global reference tables without tenant keys.
alter table public.customs_offices enable row level security;
drop policy if exists owner_console_global_all on public.customs_offices;
create policy owner_console_global_all on public.customs_offices
for all to authenticated
using (public.user_role()='owner'::public.user_role)
with check (public.user_role()='owner'::public.user_role);

alter table public.hs_codes enable row level security;
drop policy if exists owner_console_global_all on public.hs_codes;
create policy owner_console_global_all on public.hs_codes
for all to authenticated
using (public.user_role()='owner'::public.user_role)
with check (public.user_role()='owner'::public.user_role);

create or replace function public.record_global_reference_audit()
returns trigger
language plpgsql
security definer
set search_path=public,pg_catalog,pg_temp
as $$
declare v_org uuid:=public.user_org_id();
begin
  insert into public.audit_logs(organization_id,user_id,action,table_name,record_id,old_data,new_data)
  values(
    v_org,auth.uid(),tg_op,tg_table_name,
    case when tg_op='DELETE' then old.id else new.id end,
    case when tg_op='DELETE' or tg_op='UPDATE' then to_jsonb(old) else null end,
    case when tg_op='INSERT' or tg_op='UPDATE' then to_jsonb(new) else null end
  );
  return coalesce(new,old);
end;
$$;

drop trigger if exists tr_owner_customs_offices_audit on public.customs_offices;
create trigger tr_owner_customs_offices_audit
after insert or update or delete on public.customs_offices
for each row execute function public.record_global_reference_audit();

drop trigger if exists tr_owner_hs_codes_audit on public.hs_codes;
create trigger tr_owner_hs_codes_audit
after insert or update or delete on public.hs_codes
for each row execute function public.record_global_reference_audit();
