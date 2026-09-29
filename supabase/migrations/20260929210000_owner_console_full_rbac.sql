-- Customs OS Owner Console: full owner access with immutable audit/history boundaries.
-- No service-role access. All privileged operations run with the caller's session/RLS.

create or replace function public.owner_console_guard()
returns uuid
language plpgsql
security definer
stable
set search_path=public,pg_catalog,pg_temp
as $$
declare v_org uuid:=public.user_org_id();
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if v_org is null or public.user_role()<>'owner'::public.user_role then
    raise exception 'Owner access required';
  end if;
  return v_org;
end;
$$;
revoke all on function public.owner_console_guard() from public,anon,authenticated;
grant execute on function public.owner_console_guard() to authenticated;

-- Organization-scoped owner policies for all mutable application data.
do $$
declare r record;
begin
  for r in
    select distinct c.table_name
    from information_schema.columns c
    join information_schema.tables t on t.table_schema=c.table_schema and t.table_name=c.table_name
    where c.table_schema='public'
      and c.column_name='organization_id'
      and t.table_type='BASE TABLE'
      and c.table_name not in (
        'profiles',
        'audit_logs',
        'case_status_history',
        'ai_operator_commands',
        'financial_transactions',
        'ai_agent_action_logs',
        'ai_interactions',
        'ai_risk_findings',
        'ai_action_proposals',
        'file_security_events',
        'shipment_tracking_events',
        'discrepancy_logs'
      )
  loop
    execute format('alter table public.%I enable row level security',r.table_name);
    execute format('drop policy if exists owner_console_all on public.%I',r.table_name);
    execute format(
      'create policy owner_console_all on public.%I for all to authenticated using (organization_id=public.user_org_id() and public.user_role()=''owner''::public.user_role) with check (organization_id=public.user_org_id() and public.user_role()=''owner''::public.user_role)',
      r.table_name
    );
  end loop;
end $$;

-- Organization singleton/settings tables do not have an id column.\ndo $$
declare t text;
begin
  execute 'alter table public.organizations enable row level security';
  execute 'drop policy if exists owner_console_org_all on public.organizations';
  execute 'create policy owner_console_org_all on public.organizations for all to authenticated using (id=public.user_org_id() and public.user_role()=''owner''::public.user_role) with check (id=public.user_org_id() and public.user_role()=''owner''::public.user_role)';

  foreach t in array array['organization_settings','finance_org_settings'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('drop policy if exists owner_console_all on public.%I',t);
    execute format('create policy owner_console_all on public.%I for all to authenticated using (organization_id=public.user_org_id() and public.user_role()=''owner''::public.user_role) with check (organization_id=public.user_org_id() and public.user_role()=''owner''::public.user_role)',t);
  end loop;
end $$;

-- User settings is keyed by user_id instead of organization_id.
alter table public.user_settings enable row level security;
drop policy if exists owner_console_user_settings on public.user_settings;
create policy owner_console_user_settings on public.user_settings
for all to authenticated
using (
  public.user_role()='owner'::public.user_role
  and exists(select 1 from public.profiles p where p.id=user_settings.user_id and p.organization_id=public.user_org_id())
)
with check (
  public.user_role()='owner'::public.user_role
  and exists(select 1 from public.profiles p where p.id=user_settings.user_id and p.organization_id=public.user_org_id())
);

-- Immutable/log tables: owner may read all rows in the organization, but cannot mutate them.
do $$
declare t text;
begin
  foreach t in array array[
    'audit_logs','case_status_history','financial_transactions','ai_operator_commands',
    'ai_agent_action_logs','ai_interactions','ai_risk_findings','ai_action_proposals',
    'file_security_events','shipment_tracking_events','discrepancy_logs'
  ]
  loop
    if to_regclass('public.'||t) is not null then
      execute format('drop policy if exists owner_console_read on public.%I',t);
      execute format('create policy owner_console_read on public.%I for select to authenticated using (organization_id=public.user_org_id() and public.user_role()=''owner''::public.user_role)',t);
    end if;
  end loop;
end $$;

-- AI Operator command ledger stays immutable.
revoke update,delete on public.ai_operator_commands from anon,authenticated;

-- Documents are archived, not physically deleted by the Owner Console.
alter table public.shipment_documents
  add column if not exists is_archived boolean not null default false,
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references public.profiles(id) on delete set null,
  add column if not exists archive_reason text;

alter table public.customs_documents
  add column if not exists is_archived boolean not null default false,
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references public.profiles(id) on delete set null,
  add column if not exists archive_reason text;

create or replace function public.owner_archive_document(p_document_id uuid,p_reason text)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_catalog,pg_temp
as $$
declare v_org uuid:=public.owner_console_guard(); v_user uuid:=auth.uid(); v_old jsonb; v_new jsonb; v_name text; v_table text;
begin
  if nullif(trim(p_reason),'') is null then raise exception 'Archive reason is required'; end if;
  select to_jsonb(d),coalesce(d.document_name,d.original_file_name) into v_old,v_name
  from public.shipment_documents d where d.id=p_document_id and d.organization_id=v_org for update;
  if v_old is not null then
    update public.shipment_documents set is_archived=true,archived_at=now(),archived_by=v_user,archive_reason=trim(p_reason),updated_at=now()
    where id=p_document_id and organization_id=v_org
    returning to_jsonb(shipment_documents),document_name into v_new,v_name;
    insert into public.audit_logs(organization_id,user_id,action,table_name,record_id,old_data,new_data)
    values(v_org,v_user,'OWNER_ARCHIVE','shipment_documents',p_document_id,v_old,
           v_new || jsonb_build_object('_owner_reason',trim(p_reason)));
    return jsonb_build_object('table','shipment_documents','id',p_document_id,'archived',true,'reason',trim(p_reason));
  end if;

  select to_jsonb(d),coalesce(d.display_name,d.original_name) into v_old,v_name
  from public.customs_documents d where d.id=p_document_id and d.organization_id=v_org for update;
  if v_old is null then raise exception 'Document not found or access denied'; end if;

  update public.customs_documents set is_archived=true,archived_at=now(),archived_by=v_user,archive_reason=trim(p_reason),updated_at=now()
  where id=p_document_id and organization_id=v_org
  returning to_jsonb(customs_documents),coalesce(display_name,original_name) into v_new,v_name;

  insert into public.audit_logs(organization_id,user_id,action,table_name,record_id,old_data,new_data)
  values(v_org,v_user,'OWNER_ARCHIVE','customs_documents',p_document_id,v_old,
         v_new || jsonb_build_object('_owner_reason',trim(p_reason)));
  return jsonb_build_object('table','customs_documents','id',p_document_id,'archived',true,'reason',trim(p_reason));
end;
$$;
revoke all on function public.owner_archive_document(uuid,text) from public,anon,authenticated;
grant execute on function public.owner_archive_document(uuid,text) to authenticated;

-- Exceptional manual Case status override: history is append-only and reason is mandatory.
create or replace function public.owner_override_case_status(p_case_id uuid,p_new_status public.case_status,p_reason text)
returns public.cases
language plpgsql
security definer
set search_path=public,pg_catalog,pg_temp
as $$
declare v_org uuid:=public.owner_console_guard(); v_old public.cases; v_new public.cases;
begin
  if nullif(trim(p_reason),'') is null then raise exception 'Status override reason is required'; end if;
  select * into v_old from public.cases where id=p_case_id and organization_id=v_org for update;
  if not found then raise exception 'Case not found or access denied'; end if;
  update public.cases set status=p_new_status,updated_at=now() where id=p_case_id and organization_id=v_org returning * into v_new;
  insert into public.case_status_history(organization_id,case_id,previous_status,new_status,notes,changed_by)
  values(v_org,p_case_id,v_old.status,p_new_status,'OWNER OVERRIDE: '||trim(p_reason),auth.uid());
  insert into public.audit_logs(organization_id,user_id,action,table_name,record_id,old_data,new_data)
  values(v_org,auth.uid(),'OWNER_STATUS_OVERRIDE','cases',p_case_id,to_jsonb(v_old),to_jsonb(v_new)||jsonb_build_object('_owner_reason',trim(p_reason)));
  return v_new;
end;
$$;
revoke all on function public.owner_override_case_status(uuid,public.case_status,text) from public,anon,authenticated;
grant execute on function public.owner_override_case_status(uuid,public.case_status,text) to authenticated;

-- Emergency Case delete with reason; underlying integrity checks remain enforced.
create or replace function public.owner_delete_case(p_case_id uuid,p_reason text,p_confirmation text)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_catalog,pg_temp
as $$
declare v_org uuid:=public.owner_console_guard(); v_old public.cases;
begin
  if nullif(trim(p_reason),'') is null then raise exception 'Delete reason is required'; end if;
  if trim(p_confirmation)<>'تأیید نهایی حذف پرونده' then raise exception 'Final confirmation phrase is invalid'; end if;
  select * into v_old from public.cases where id=p_case_id and organization_id=v_org for update;
  if not found then raise exception 'Case not found or access denied'; end if;
  if exists(select 1 from public.financial_transactions where case_id=p_case_id and organization_id=v_org) then
    raise exception 'Case has financial transactions and cannot be deleted';
  end if;
  if exists(select 1 from public.case_exit_operations where case_id=p_case_id and organization_id=v_org) then
    raise exception 'Case has exit operation and cannot be deleted';
  end if;
  delete from public.cases where id=p_case_id and organization_id=v_org;
  insert into public.audit_logs(organization_id,user_id,action,table_name,record_id,old_data,new_data)
  values(v_org,auth.uid(),'OWNER_DELETE','cases',p_case_id,to_jsonb(v_old),
         jsonb_build_object('deleted',true,'_owner_reason',trim(p_reason)));
  return jsonb_build_object('case_id',p_case_id,'deleted',true);
end;
$$;
revoke all on function public.owner_delete_case(uuid,text,text) from public,anon,authenticated;
grant execute on function public.owner_delete_case(uuid,text,text) to authenticated;

-- Owner-only user management with reason; physical profile deletion remains blocked by trigger.
create or replace function public.owner_manage_profile(
  p_user_id uuid,
  p_role public.user_role default null,
  p_client_id uuid default null,
  p_full_name text default null,
  p_phone text default null,
  p_is_active boolean default null,
  p_reason text default null
)
returns public.profiles
language plpgsql
security definer
set search_path=public,pg_catalog,pg_temp
as $$
declare v_org uuid:=public.owner_console_guard(); v_old public.profiles; v_new public.profiles;
begin
  if nullif(trim(p_reason),'') is null then raise exception 'User management reason is required'; end if;
  select * into v_old from public.profiles where id=p_user_id and organization_id=v_org for update;
  if not found then raise exception 'User profile not found'; end if;
  if p_client_id is not null and not exists(select 1 from public.clients c where c.id=p_client_id and c.organization_id=v_org) then
    raise exception 'Client association does not belong to organization';
  end if;
  update public.profiles
  set role=coalesce(p_role,role),
      client_id=case when p_client_id is null then client_id else p_client_id end,
      full_name=coalesce(nullif(trim(p_full_name),''),full_name),
      phone=case when p_phone is null then phone else nullif(trim(p_phone),'') end,
      is_active=coalesce(p_is_active,is_active),
      updated_at=now()
  where id=p_user_id and organization_id=v_org
  returning * into v_new;
  insert into public.audit_logs(organization_id,user_id,action,table_name,record_id,old_data,new_data)
  values(v_org,auth.uid(),'OWNER_USER_MANAGE','profiles',p_user_id,to_jsonb(v_old),to_jsonb(v_new)||jsonb_build_object('_owner_reason',trim(p_reason)));
  return v_new;
end;
$$;
revoke all on function public.owner_manage_profile(uuid,public.user_role,uuid,text,text,boolean,text) from public,anon,authenticated;
grant execute on function public.owner_manage_profile(uuid,public.user_role,uuid,text,text,boolean,text) to authenticated;

-- Owner-only voucher void wrapper; the existing immutable void fields remain protected.
create or replace function public.owner_void_customs_voucher_line(p_line_id uuid,p_reason text,p_confirmation text)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_catalog,pg_temp
as $$
begin
  perform public.owner_console_guard();
  if trim(coalesce(p_confirmation,''))<>'تأیید نهایی ابطال ردیف سند' then raise exception 'Final confirmation phrase is invalid'; end if;
  return public.void_customs_voucher_line(p_line_id,p_reason);
end;
$$;
revoke all on function public.owner_void_customs_voucher_line(uuid,text,text) from public,anon,authenticated;
grant execute on function public.owner_void_customs_voucher_line(uuid,text,text) to authenticated;

-- Audit all owner-editable organization-scoped tables. Existing triggers are replaced idempotently.
do $$
declare r record;
begin
  for r in
    select distinct c.table_name
    from information_schema.columns c
    join information_schema.tables t on t.table_schema=c.table_schema and t.table_name=c.table_name
    where c.table_schema='public'
      and c.column_name='organization_id'
      and t.table_type='BASE TABLE'
      and c.table_name not in (
        'audit_logs','financial_transactions','ai_interactions','ai_agent_action_logs',
        'ai_risk_findings','ai_action_proposals','file_security_events','shipment_tracking_events',
        'discrepancy_logs','ai_operator_commands'
      )
      and exists(select 1 from information_schema.columns x where x.table_schema='public' and x.table_name=c.table_name and x.column_name='id')
  loop
    execute format('drop trigger if exists tr_owner_console_audit on public.%I',r.table_name);
    execute format('create trigger tr_owner_console_audit after insert or update or delete on public.%I for each row execute function public.record_audit_event()',r.table_name);
  end loop;
end $$;

-- Append-only audit/status history: INSERT is audit-worthy; UPDATE/DELETE remain blocked by existing tamper triggers.
drop trigger if exists tr_owner_console_audit on public.case_status_history;
create trigger tr_owner_console_audit after insert on public.case_status_history for each row execute function public.record_audit_event();

-- Singleton settings audit uses organization_id as record_id because these tables intentionally have no id column.
create or replace function public.record_org_settings_audit()
returns trigger
language plpgsql
security definer
set search_path=public,pg_catalog,pg_temp
as $$
declare v_old jsonb:=null; v_new jsonb:=null; v_org uuid;
begin
  if tg_op='DELETE' then v_org:=old.organization_id; v_old:=to_jsonb(old);
  else v_org:=new.organization_id; v_new:=to_jsonb(new); if tg_op='UPDATE' then v_old:=to_jsonb(old); end if; end if;
  insert into public.audit_logs(organization_id,user_id,action,table_name,record_id,old_data,new_data)
  values(v_org,auth.uid(),tg_op,tg_table_name,v_org,v_old,v_new);
  return coalesce(new,old);
end;
$$;
drop trigger if exists tr_owner_console_audit on public.organization_settings;
create trigger tr_owner_console_audit after insert or update or delete on public.organization_settings for each row execute function public.record_org_settings_audit();
drop trigger if exists tr_owner_console_audit on public.finance_org_settings;
create trigger tr_owner_console_audit after insert or update or delete on public.finance_org_settings for each row execute function public.record_org_settings_audit();
