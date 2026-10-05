create or replace function public.initialize_declaration_checklist(p_declaration_id uuid)
returns void language plpgsql
set search_path=public,pg_temp
as $$
declare v_org_id uuid:=public.user_org_id();k text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if public.user_role() not in('owner','admin','broker','accountant','warehouse') then raise exception 'User is not allowed'; end if;
  if not exists(select 1 from public.customs_declarations where id=p_declaration_id and organization_id=v_org_id) then raise exception 'Declaration not found or access denied'; end if;
  foreach k in array array['مالیات علی الحساب','درخواست ضمانتنامه حقوق ورودی و ارزش افزوده','ارزیابی','آزمایشگاه','مجوز استاندارد','نوبت کارشناسی','کد ساتا','تبصره دو منطقه آزاد'] loop
    insert into public.declaration_checklist_items(organization_id,declaration_id,item_key,item_label,sort_order,source,is_active)
    values(v_org_id,p_declaration_id,k,k,case k
      when 'مالیات علی الحساب' then 10 when 'درخواست ضمانتنامه حقوق ورودی و ارزش افزوده' then 20 when 'ارزیابی' then 30 when 'آزمایشگاه' then 40
      when 'مجوز استاندارد' then 50 when 'نوبت کارشناسی' then 60 when 'کد ساتا' then 70 when 'تبصره دو منطقه آزاد' then 80 else 100 end,'system',true)
    on conflict(declaration_id,item_key) do update set item_label=coalesce(public.declaration_checklist_items.item_label,excluded.item_label),
      sort_order=least(public.declaration_checklist_items.sort_order,excluded.sort_order),
      is_active=case when public.declaration_checklist_items.source='manual' then public.declaration_checklist_items.is_active else true end;
  end loop;
end; $$;

revoke execute on function public.initialize_declaration_checklist(uuid) from public,anon;
grant execute on function public.initialize_declaration_checklist(uuid) to authenticated;

create or replace function public.sync_declaration_workflow_stage()
returns trigger language plpgsql security definer
set search_path=public,pg_catalog,pg_temp
as $$
declare v_declaration_id uuid:=coalesce(new.declaration_id,old.declaration_id);v_current_stage integer;v_total_count integer;v_done_count integer;
begin
  select workflow_stage into v_current_stage from public.customs_declarations where id=v_declaration_id;
  select count(*),count(*) filter(where completed=true) into v_total_count,v_done_count
  from public.declaration_checklist_items
  where declaration_id=v_declaration_id and is_active=true
    and organization_id=(select organization_id from public.customs_declarations where id=v_declaration_id);
  update public.customs_declarations set workflow_stage=case
    when v_current_stage=6 then 6
    when v_total_count>0 and v_total_count=v_done_count then 6
    else 5 end,updated_at=now()
  where id=v_declaration_id;
  return coalesce(new,old);
end; $$;

revoke execute on function public.sync_declaration_workflow_stage() from public,anon;
grant execute on function public.sync_declaration_workflow_stage() to authenticated,service_role;