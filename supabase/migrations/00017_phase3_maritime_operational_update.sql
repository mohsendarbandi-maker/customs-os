create or replace function public.update_shipment_maritime_data(
  p_case_id uuid, p_shipping_line text, p_bill_of_lading_no text, p_bill_of_lading_year smallint, p_vessel_name text,
  p_voyage_no text default null, p_origin_port text default null, p_destination_port text default null,
  p_cargo_count numeric default null, p_cargo_count_unit text default null, p_net_weight_kg numeric default null,
  p_gross_weight_kg numeric default null, p_tally_no text default null, p_release_invoice_no text default null,
  p_release_invoice_date date default null, p_release_status text default null, p_electronic_release_no text default null
) returns uuid language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_org uuid; v_shipment uuid; v_vessel uuid;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  v_org := public.user_org_id();
  if v_org is null or public.user_role() not in ('owner','admin','broker') then raise exception 'insufficient access'; end if;
  if nullif(trim(p_shipping_line),'') is null then raise exception 'shipping line is required'; end if;
  if nullif(trim(p_bill_of_lading_no),'') is null then raise exception 'B/L number is required'; end if;
  if p_bill_of_lading_year < 2000 or p_bill_of_lading_year > 2100 then raise exception 'invalid B/L year'; end if;
  if nullif(trim(p_vessel_name),'') is null then raise exception 'vessel name is required'; end if;
  if p_gross_weight_kg is not null and p_gross_weight_kg <= 0 then raise exception 'gross weight must be positive'; end if;
  select id into v_vessel from public.vessels where organization_id=v_org and lower(trim(name))=lower(trim(p_vessel_name)) limit 1;
  if v_vessel is null then insert into public.vessels(organization_id,name) values(v_org,trim(p_vessel_name)) returning id into v_vessel; end if;
  select id into v_shipment from public.shipments where organization_id=v_org and case_id=p_case_id and lower(trim(bill_of_lading_no))=lower(trim(p_bill_of_lading_no)) and bill_of_lading_year=p_bill_of_lading_year limit 1;
  if v_shipment is null then
    insert into public.shipments(organization_id,case_id,vessel_id,transport_mode,bill_of_lading_no,bill_of_lading_year,shipping_line,gross_weight_kg,origin_port,destination_port,voyage_no,cargo_count,cargo_count_unit,net_weight_kg,tally_no,release_invoice_no,release_invoice_date,release_status,electronic_release_no)
    values(v_org,p_case_id,v_vessel,'sea',trim(p_bill_of_lading_no),p_bill_of_lading_year,trim(p_shipping_line),coalesce(p_gross_weight_kg,1),nullif(trim(p_origin_port),''),nullif(trim(p_destination_port),''),nullif(trim(p_voyage_no),''),p_cargo_count,nullif(trim(p_cargo_count_unit),''),p_net_weight_kg,nullif(trim(p_tally_no),''),nullif(trim(p_release_invoice_no),''),p_release_invoice_date,p_release_status,nullif(trim(p_electronic_release_no),'')) returning id into v_shipment;
  else
    update public.shipments set vessel_id=v_vessel,shipping_line=trim(p_shipping_line),voyage_no=nullif(trim(p_voyage_no),''),origin_port=nullif(trim(p_origin_port),''),destination_port=nullif(trim(p_destination_port),''),cargo_count=p_cargo_count,cargo_count_unit=nullif(trim(p_cargo_count_unit),''),net_weight_kg=p_net_weight_kg,gross_weight_kg=coalesce(p_gross_weight_kg,gross_weight_kg),tally_no=nullif(trim(p_tally_no),''),release_invoice_no=nullif(trim(p_release_invoice_no),''),release_invoice_date=p_release_invoice_date,release_status=p_release_status,electronic_release_no=nullif(trim(p_electronic_release_no),'') where id=v_shipment and organization_id=v_org;
  end if;
  return v_shipment;
end; $$;
revoke execute on function public.update_shipment_maritime_data(uuid,text,text,smallint,text,text,text,text,numeric,text,numeric,numeric,text,text,date,text,text) from public, anon;
grant execute on function public.update_shipment_maritime_data(uuid,text,text,smallint,text,text,text,text,numeric,text,numeric,numeric,text,text,date,text,text) to authenticated;
