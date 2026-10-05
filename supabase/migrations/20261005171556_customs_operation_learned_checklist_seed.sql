create or replace function public.initialize_declaration_checklist(p_declaration_id uuid)
returns void language plpgsql
set search_path=public,pg_temp
as $$
declare
  v_org_id uuid:=public.user_org_id();v_hs text;v_path text:='';v_rule record;k text;r record;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if public.user_role() not in('owner','admin','broker','accountant','warehouse') then raise exception 'User is not allowed'; end if;
  if not exists(select 1 from public.customs_declarations where id=p_declaration_id and organization_id=v_org_id) then raise exception 'Declaration not found or access denied'; end if;

  select coalesce(nullif(regexp_replace(sc.tariff_code,'[^0-9]','','g'),''),
                  nullif(regexp_replace(c.tariff_code,'[^0-9]','','g'),''),
                  nullif(regexp_replace(ro.tariff_code,'[^0-9]','','g'),'')),
         coalesce(d.customs_path,'')
  into v_hs,v_path
  from public.customs_declarations d
  left join public.shipment_customs_data sc on sc.shipment_id=d.shipment_id and sc.organization_id=v_org_id
  left join public.cases c on c.id=d.case_id and c.organization_id=v_org_id
  left join lateral(select ro1.tariff_code from public.registration_orders ro1 where ro1.case_id=d.case_id and ro1.organization_id=v_org_id order by ro1.updated_at desc nulls last,ro1.created_at desc limit 1)ro on true
  where d.id=p_declaration_id and d.organization_id=v_org_id;

  foreach k in array array['مالیات علی الحساب','درخواست ضمانتنامه حقوق ورودی و ارزش افزوده','ارزیابی','آزمایشگاه','مجوز استاندارد','نوبت کارشناسی','کد ساتا','تبصره دو منطقه آزاد'] loop
    insert into public.declaration_checklist_items(organization_id,declaration_id,item_key,item_label,sort_order,source,is_active)
    values(v_org_id,p_declaration_id,k,k,case k
      when 'مالیات علی الحساب' then 10 when 'درخواست ضمانتنامه حقوق ورودی و ارزش افزوده' then 20 when 'ارزیابی' then 30 when 'آزمایشگاه' then 40
      when 'مجوز استاندارد' then 50 when 'نوبت کارشناسی' then 60 when 'کد ساتا' then 70 when 'تبصره دو منطقه آزاد' then 80 else 100 end,'system',true)
    on conflict(declaration_id,item_key) do update set item_label=coalesce(public.declaration_checklist_items.item_label,excluded.item_label),
      sort_order=least(public.declaration_checklist_items.sort_order,excluded.sort_order),
      is_active=case when public.declaration_checklist_items.source='manual' then public.declaration_checklist_items.is_active else true end;
  end loop;

  if v_hs is not null and v_hs<>'' then
    select * into v_rule
    from public.customs_operation_rules
    where organization_id=v_org_id and is_active=true and v_hs like hs_code_prefix||'%'
      and (customs_path='' or customs_path=v_path) and evidence_count>=2
    order by length(hs_code_prefix) desc,evidence_count desc limit 1;

    if v_rule.id is not null then
      for r in select key as label,(value::integer) as count
      from jsonb_each_text(coalesce(v_rule.checklist_counts,'{}'::jsonb))
      where (value::integer)::numeric/greatest(v_rule.evidence_count,1)::numeric>=0.6
      order by(value::integer) desc,key loop
        if not exists(select 1 from public.declaration_checklist_items where declaration_id=p_declaration_id and organization_id=v_org_id and item_label=r.label) then
          insert into public.declaration_checklist_items(organization_id,declaration_id,item_key,item_label,sort_order,source,is_active)
          values(v_org_id,p_declaration_id,gen_random_uuid()::text,r.label,1000+r.count,'learned',true);
        end if;
      end loop;
    end if;
  end if;
end; $$;

revoke execute on function public.initialize_declaration_checklist(uuid) from public,anon;
grant execute on function public.initialize_declaration_checklist(uuid) to authenticated;