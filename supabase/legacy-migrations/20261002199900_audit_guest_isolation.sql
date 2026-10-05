-- Audit guest isolation: demo-only, read-only, profile-backed enforcement.
-- Live schema was applied separately; keep this migration as the source-of-truth record.

alter table public.profiles
  add column if not exists is_audit_guest boolean not null default false;

create or replace function public.block_audit_guest_writes()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
begin
  if exists (
    select 1 from public.profiles
    where id = auth.uid()
      and is_audit_guest = true
      and is_active = true
  ) then
    raise exception 'Audit guest is read-only';
  end if;
  return coalesce(NEW, OLD);
end;
$function$;

revoke execute on function public.block_audit_guest_writes() from public, anon, authenticated;

create or replace function public.create_audit_guest_profile()
returns public.profiles
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $function$
declare result public.profiles; v_demo_org uuid; v_demo_client uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if coalesce((auth.jwt()->>'is_anonymous')::boolean,false) is not true then
    raise exception 'Audit guest profile is only available to anonymous sessions';
  end if;
  select id into v_demo_org from public.organizations where name='Customs OS Demo' limit 1;
  if v_demo_org is null then raise exception 'Demo organization is not configured'; end if;
  select id into v_demo_client from public.clients where organization_id=v_demo_org and name='Demo Importer' limit 1;
  if v_demo_client is null then raise exception 'Demo client is not configured'; end if;

  select * into result from public.profiles where id=auth.uid();
  if found then
    if result.is_audit_guest and result.organization_id=v_demo_org
       and result.role='client'::public.user_role and result.is_active then return result; end if;
    raise exception 'Authenticated user already has a protected profile; guest profile cannot change organization or role';
  end if;

  insert into public.profiles(id,organization_id,role,client_id,full_name,is_active,is_audit_guest)
  values(auth.uid(),v_demo_org,'client'::public.user_role,v_demo_client,'Audit Guest',true,true)
  on conflict(id) do nothing returning * into result;

  if result.id is null then
    select * into result from public.profiles where id=auth.uid();
    if not result.is_audit_guest or result.organization_id<>v_demo_org
       or result.role<>'client'::public.user_role or not result.is_active then
      raise exception 'Existing profile cannot be converted into an audit guest';
    end if;
  end if;
  return result;
end;
$function$;

revoke execute on function public.create_audit_guest_profile() from public, anon;
grant execute on function public.create_audit_guest_profile() to authenticated;


insert into public.organizations (name)
select 'Customs OS Demo'
where not exists (select 1 from public.organizations where name='Customs OS Demo');

do $seed$
declare v_org uuid; v_client uuid; v_case uuid; v_shipment uuid;
begin
  select id into v_org from public.organizations where name='Customs OS Demo' limit 1;
  insert into public.clients(organization_id,name,economic_code,notes)
  select v_org,'Demo Importer','DEMO-0001','Synthetic data only — audit guest sandbox'
  where not exists(select 1 from public.clients where organization_id=v_org and name='Demo Importer');
  select id into v_client from public.clients where organization_id=v_org and name='Demo Importer' limit 1;
  insert into public.cases(organization_id,client_id,case_number,status,cargo_description,origin_country_code,transaction_country_code,delivery_term,invoice_amount,invoice_currency,net_weight_kg,gross_weight_kg,display_name)
  select v_org,v_client,'DEMO-CASE-001','draft'::public.case_status,'Synthetic demo cargo — steel coils','RU','IR','CFR',25000,'USD'::public.currency_code,22000,22500,'Demo steel coils'
  where not exists(select 1 from public.cases where organization_id=v_org and case_number='DEMO-CASE-001')
  returning id into v_case;
  if v_case is null then select id into v_case from public.cases where organization_id=v_org and case_number='DEMO-CASE-001' limit 1; end if;
  insert into public.shipments(organization_id,case_id,transport_mode,bill_of_lading_no,gross_weight_kg,origin_port,destination_port,shipping_line,cargo_count,cargo_count_unit,net_weight_kg,display_name)
  select v_org,v_case,'sea'::public.transport_mode,'DEMO-BL-001',22500,'Astrakhan','Bandar Anzali','Demo Shipping Line',22,'rolls',22000,'Demo shipment — steel coils'
  where not exists(select 1 from public.shipments where organization_id=v_org and bill_of_lading_no='DEMO-BL-001')
  returning id into v_shipment;
  if v_shipment is null then select id into v_shipment from public.shipments where organization_id=v_org and bill_of_lading_no='DEMO-BL-001' limit 1; end if;
  insert into public.financial_transactions(organization_id,case_id,transaction_type,category,original_amount,original_currency,exchange_rate,base_amount_irr,description)
  select v_org,v_case,'expense'::public.transaction_type,'Demo invoice',25000,'USD'::public.currency_code,1,25000,'Synthetic demo invoice — not a real payable'
  where not exists(select 1 from public.financial_transactions where organization_id=v_org and case_id=v_case and category='Demo invoice');
  insert into public.shipment_documents(organization_id,shipment_id,document_name,original_file_name,storage_path,mime_type,file_size_bytes)
  select v_org,v_shipment,'Demo commercial invoice','demo-commercial-invoice.pdf','demo/audit-guest/demo-commercial-invoice.pdf','application/pdf',1024
  where not exists(select 1 from public.shipment_documents where organization_id=v_org and shipment_id=v_shipment and original_file_name='demo-commercial-invoice.pdf');
end
$seed$;

