alter policy customs_operation_rules_select on public.customs_operation_rules
using(organization_id=public.user_org_id() and public.user_role()=any(array['owner','admin','broker','warehouse']::public.user_role[]));

revoke execute on function public.add_declaration_checklist_item(uuid,text,integer) from public,anon;
revoke execute on function public.set_declaration_checklist_note(uuid,text) from public,anon;
revoke execute on function public.set_declaration_checklist_item_active(uuid,boolean) from public,anon;
revoke execute on function public.set_shipment_ship_pass(uuid,boolean) from public,anon;

-- The learning function and stage transition are added here so this migration chain
-- remains replayable before the later counter/workflow refinements.
create or replace function public.record_customs_operation_learning(p_declaration_id uuid)
returns uuid language plpgsql security definer
set search_path=public,pg_catalog,pg_temp
as $$
declare
  v_org uuid:=public.user_org_id();v_role text:=public.user_role()::text;
  v_decl public.customs_declarations;v_hs text;v_path text:='';v_transport text:='sea';
  v_rule_id uuid;v_old_evidence integer:=0;v_event_exists boolean:=false;
  v_snapshot jsonb:='{}'::jsonb;v_checklist_snapshot jsonb:='[]'::jsonb;
  v_checklist_counts jsonb:='{}'::jsonb;v_field_counts jsonb:='{}'::jsonb;v_stages integer[]:=array[4,6];
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if v_org is null or v_role not in ('owner','admin','broker','warehouse') then raise exception 'User is not allowed to learn customs operations'; end if;
  select * into v_decl from public.customs_declarations where id=p_declaration_id and organization_id=v_org;
  if v_decl.id is null then raise exception 'Declaration not found or access denied'; end if;
  select coalesce(nullif(regexp_replace(sc.tariff_code,'[^0-9]','','g'),''),
                  nullif(regexp_replace(c.tariff_code,'[^0-9]','','g'),''),
                  nullif(regexp_replace(ro.tariff_code,'[^0-9]','','g'),'')),
         coalesce(v_decl.customs_path,''),coalesce(s.transport_mode::text,'sea')
  into v_hs,v_path,v_transport
  from public.customs_declarations d
  left join public.shipments s on s.id=d.shipment_id and s.organization_id=v_org
  left join public.shipment_customs_data sc on sc.shipment_id=d.shipment_id and sc.organization_id=v_org
  left join public.cases c on c.id=d.case_id and c.organization_id=v_org
  left join lateral(select ro1.tariff_code from public.registration_orders ro1 where ro1.case_id=d.case_id and ro1.organization_id=v_org order by ro1.updated_at desc nulls last,ro1.created_at desc limit 1)ro on true
  where d.id=p_declaration_id;
  if v_hs is null then return null; end if;

  select exists(select 1 from public.customs_operation_learning_events where declaration_id=p_declaration_id and organization_id=v_org) into v_event_exists;

  select coalesce(jsonb_agg(coalesce(item_label,item_key) order by sort_order,id),'[]'::jsonb)
  into v_checklist_snapshot
  from public.declaration_checklist_items
  where declaration_id=p_declaration_id and organization_id=v_org and is_active;

  v_snapshot=jsonb_build_object('tariff_code',v_hs,'customs_path',v_path,'kottaj_number',v_decl.kottaj_number,
    'declaration_date',v_decl.declaration_date,'payment_reference',v_decl.payment_reference,'total_duties_irr',v_decl.total_duties_irr);

  if v_decl.shipment_id is not null then
    select v_snapshot||jsonb_build_object('registration_order_no',sc.registration_order_no,'warehouse_receipt_no',sc.warehouse_receipt_no,
      'cargo_description',sc.cargo_description,'origin_country',sc.origin_country,'transaction_country',sc.transaction_country,
      'delivery_term',sc.delivery_term,'invoice_amount',sc.invoice_amount,'invoice_currency',sc.invoice_currency,
      'bank_name',sc.bank_name,'bank_branch',sc.bank_branch,'lc_number',sc.lc_number,'duty_rate',sc.duty_rate,
      'net_weight_kg',sc.net_weight_kg,'gross_weight_kg',sc.gross_weight_kg,'bill_of_lading',sc.bill_of_lading,
      'insurance_irr',sc.insurance_irr,'required_documents',sc.required_documents,'source_method',sc.source_method)
    into v_snapshot from public.shipment_customs_data sc
    where sc.shipment_id=v_decl.shipment_id and sc.organization_id=v_org;
  end if;

  insert into public.customs_operation_learning_events(organization_id,declaration_id,shipment_id,hs_code,customs_path,checklist_snapshot,field_snapshot,workflow_stages,created_by)
  values(v_org,p_declaration_id,v_decl.shipment_id,v_hs,v_path,v_checklist_snapshot,v_snapshot,v_stages,auth.uid())
  on conflict(declaration_id) do update set shipment_id=excluded.shipment_id,hs_code=excluded.hs_code,customs_path=excluded.customs_path,
    checklist_snapshot=excluded.checklist_snapshot,field_snapshot=excluded.field_snapshot,workflow_stages=excluded.workflow_stages;

  select coalesce(jsonb_object_agg(q.label,q.total_count),'{}'::jsonb) into v_checklist_counts
  from(select label,count(*)::int total_count from public.customs_operation_learning_events e
       cross join lateral jsonb_array_elements_text(e.checklist_snapshot)a(label)
       where e.organization_id=v_org and e.hs_code=v_hs and e.customs_path=v_path group by label)q;

  select coalesce(jsonb_object_agg(f.key,f.total_count),'{}'::jsonb) into v_field_counts
  from(select key,count(*)::int total_count from public.customs_operation_learning_events e
       cross join lateral jsonb_each(e.field_snapshot)j(key,value)
       where e.organization_id=v_org and e.hs_code=v_hs and e.customs_path=v_path
         and j.value is not null and btrim(trim(both '"' from j.value::text))<>'' group by key)f;

  select id,evidence_count into v_rule_id,v_old_evidence from public.customs_operation_rules
  where organization_id=v_org and hs_code_prefix=v_hs and customs_path=v_path and transport_mode=v_transport limit 1;

  if v_rule_id is null then
    insert into public.customs_operation_rules(organization_id,rule_name,hs_code_prefix,customs_path,transport_mode,checklist_counts,field_counts,workflow_stages,evidence_count,confidence,source,is_active,created_by,updated_by)
    values(v_org,'یادگیری عملیات — HS '||v_hs,v_hs,v_path,v_transport,v_checklist_counts,v_field_counts,v_stages,1,0.60,'learned',false,auth.uid(),auth.uid())
    returning id into v_rule_id;
  elsif not v_event_exists then
    update public.customs_operation_rules set evidence_count=v_old_evidence+1,checklist_counts=v_checklist_counts,field_counts=v_field_counts,
      confidence=least(0.98,0.45+(0.15*(v_old_evidence+1))),is_active=(v_old_evidence+1>=2),source='learned',
      updated_by=auth.uid(),updated_at=now() where id=v_rule_id;
  else
    update public.customs_operation_rules set checklist_counts=v_checklist_counts,field_counts=v_field_counts,updated_by=auth.uid(),updated_at=now() where id=v_rule_id;
  end if;
  return v_rule_id;
end; $$;

revoke execute on function public.record_customs_operation_learning(uuid) from public,anon;
grant execute on function public.record_customs_operation_learning(uuid) to authenticated;

create or replace function public.advance_declaration_to_exit_stage(p_declaration_id uuid,p_remaining_items text[] default '{}'::text[])
returns void language plpgsql security definer
set search_path=public,pg_catalog,pg_temp
as $$
declare v_org uuid:=public.user_org_id();v_role text:=public.user_role()::text;v_old public.customs_declarations;v_remaining jsonb:=to_jsonb(coalesce(p_remaining_items,'{}'::text[]));
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if v_org is null or v_role not in ('owner','admin','broker','warehouse') then raise exception 'User is not allowed to advance declaration stage'; end if;
  select * into v_old from public.customs_declarations where id=p_declaration_id and organization_id=v_org for update;
  if v_old.id is null then raise exception 'Declaration not found or access denied'; end if;
  if v_old.workflow_stage is null or v_old.workflow_stage not in(4,5,6) then raise exception 'اظهارنامه در وضعیت قابل انتقال به مرحله درب خروج نیست'; end if;
  perform public.record_customs_operation_learning(p_declaration_id);
  update public.customs_declarations set workflow_stage=6,updated_at=now() where id=p_declaration_id and organization_id=v_org;
  insert into public.audit_logs(organization_id,user_id,action,table_name,record_id,old_data,new_data)
  values(v_org,auth.uid(),case when coalesce(array_length(p_remaining_items,1),0)>0 then 'DECLARATION_PARTIAL_STAGE_ADVANCE' else 'DECLARATION_STAGE_ADVANCE' end,
    'customs_declarations',p_declaration_id,
    jsonb_build_object('workflow_stage',v_old.workflow_stage,'kottaj_number',v_old.kottaj_number),
    jsonb_build_object('workflow_stage',6,'remaining_checklist_items',v_remaining,'partial_allowed',coalesce(array_length(p_remaining_items,1),0)>0,'reason','عبور عملیاتی به درب خروج؛ موارد باقی‌مانده مرحله عملیات گمرکی می‌توانند در ادامه تکمیل شوند'));
end; $$;
revoke execute on function public.advance_declaration_to_exit_stage(uuid,text[]) from public,anon;
grant execute on function public.advance_declaration_to_exit_stage(uuid,text[]) to authenticated;