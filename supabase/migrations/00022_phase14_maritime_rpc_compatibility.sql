-- 00022: Align the maritime persistence RPC with the Operations UI.
-- p_client_id is validated against the tenant and accepted as an optional compatibility parameter.

CREATE OR REPLACE FUNCTION public.update_shipment_maritime_data(
  p_case_id uuid,p_shipping_line text,p_bill_of_lading_no text,p_bill_of_lading_year smallint,
  p_vessel_name text,p_vessel_imo text DEFAULT NULL,p_vessel_flag_code text DEFAULT NULL,
  p_voyage_no text DEFAULT NULL,p_origin_port text DEFAULT NULL,p_destination_port text DEFAULT NULL,
  p_cargo_count numeric DEFAULT NULL,p_cargo_count_unit text DEFAULT NULL,p_net_weight_kg numeric DEFAULT NULL,
  p_gross_weight_kg numeric DEFAULT NULL,p_tally_no text DEFAULT NULL,p_release_invoice_no text DEFAULT NULL,
  p_release_invoice_date date DEFAULT NULL,p_release_status text DEFAULT NULL,p_electronic_release_no text DEFAULT NULL,
  p_client_id uuid DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_org uuid; v_shipment uuid; v_vessel uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  v_org:=public.user_org_id();
  IF v_org IS NULL OR public.user_role() NOT IN ('owner','admin','broker') THEN RAISE EXCEPTION 'Insufficient access'; END IF;
  IF p_case_id IS NOT NULL AND NOT EXISTS(select 1 from public.cases where id=p_case_id and organization_id=v_org) THEN RAISE EXCEPTION 'Case not found or access denied'; END IF;
  IF p_client_id IS NOT NULL AND NOT EXISTS(select 1 from public.clients where id=p_client_id and organization_id=v_org) THEN RAISE EXCEPTION 'Client not found or access denied'; END IF;
  IF nullif(trim(p_shipping_line),'') IS NULL THEN RAISE EXCEPTION 'Shipping line is required'; END IF;
  IF nullif(trim(p_bill_of_lading_no),'') IS NULL THEN RAISE EXCEPTION 'B/L number is required'; END IF;
  IF p_bill_of_lading_year<2000 OR p_bill_of_lading_year>2100 THEN RAISE EXCEPTION 'Invalid B/L year'; END IF;
  IF nullif(trim(p_vessel_name),'') IS NULL THEN RAISE EXCEPTION 'Vessel name is required'; END IF;
  IF p_gross_weight_kg IS NOT NULL AND p_gross_weight_kg<=0 THEN RAISE EXCEPTION 'Gross weight must be positive'; END IF;
  IF p_net_weight_kg IS NOT NULL AND p_net_weight_kg<0 THEN RAISE EXCEPTION 'Net weight cannot be negative'; END IF;
  IF p_vessel_imo IS NOT NULL AND trim(p_vessel_imo)<>'' AND trim(p_vessel_imo)!~'^[0-9]{7}$' THEN RAISE EXCEPTION 'IMO number must contain 7 digits'; END IF;
  IF p_vessel_flag_code IS NOT NULL AND trim(p_vessel_flag_code)<>'' AND upper(trim(p_vessel_flag_code))!~'^[A-Z]{2}$' THEN RAISE EXCEPTION 'Vessel flag must be a 2-letter ISO country code'; END IF;
  IF p_client_id IS NULL THEN SELECT c.client_id INTO p_client_id FROM public.cases c WHERE c.id=p_case_id AND c.organization_id=v_org; END IF;

  SELECT id INTO v_vessel FROM public.vessels WHERE organization_id=v_org AND lower(trim(name))=lower(trim(p_vessel_name)) LIMIT 1;
  IF v_vessel IS NULL THEN
    INSERT INTO public.vessels(organization_id,name,imo_number,flag_code,flag)
    VALUES(v_org,trim(p_vessel_name),nullif(trim(p_vessel_imo),''),upper(nullif(trim(p_vessel_flag_code),'')),upper(nullif(trim(p_vessel_flag_code),''))) RETURNING id INTO v_vessel;
  ELSE
    UPDATE public.vessels SET imo_number=coalesce(nullif(trim(p_vessel_imo),''),imo_number),flag_code=coalesce(upper(nullif(trim(p_vessel_flag_code),'')),flag_code),flag=coalesce(upper(nullif(trim(p_vessel_flag_code),'')),flag)
    WHERE id=v_vessel AND organization_id=v_org;
  END IF;

  SELECT id INTO v_shipment FROM public.shipments
  WHERE organization_id=v_org AND bill_of_lading_year=p_bill_of_lading_year
    AND lower(trim(shipping_line))=lower(trim(p_shipping_line))
    AND lower(trim(bill_of_lading_no))=lower(trim(p_bill_of_lading_no)) LIMIT 1;

  IF v_shipment IS NULL THEN
    INSERT INTO public.shipments(organization_id,case_id,vessel_id,transport_mode,bill_of_lading_no,bill_of_lading_year,shipping_line,gross_weight_kg,origin_port,destination_port,voyage_no,cargo_count,cargo_count_unit,net_weight_kg,tally_no,release_invoice_no,release_invoice_date,release_status,electronic_release_no,current_status)
    VALUES(v_org,p_case_id,v_vessel,'sea',trim(p_bill_of_lading_no),p_bill_of_lading_year,trim(p_shipping_line),coalesce(p_gross_weight_kg,1),nullif(trim(p_origin_port),''),nullif(trim(p_destination_port),''),nullif(trim(p_voyage_no),''),p_cargo_count,nullif(trim(p_cargo_count_unit),''),p_net_weight_kg,nullif(trim(p_tally_no),''),nullif(trim(p_release_invoice_no),''),p_release_invoice_date,p_release_status,nullif(trim(p_electronic_release_no),''),'draft') RETURNING id INTO v_shipment;
  ELSE
    UPDATE public.shipments SET case_id=coalesce(p_case_id,case_id),vessel_id=v_vessel,shipping_line=trim(p_shipping_line),voyage_no=nullif(trim(p_voyage_no),''),origin_port=nullif(trim(p_origin_port),''),destination_port=nullif(trim(p_destination_port),''),cargo_count=p_cargo_count,cargo_count_unit=nullif(trim(p_cargo_count_unit),''),net_weight_kg=p_net_weight_kg,gross_weight_kg=coalesce(p_gross_weight_kg,gross_weight_kg),tally_no=nullif(trim(p_tally_no),''),release_invoice_no=nullif(trim(p_release_invoice_no),''),release_invoice_date=p_release_invoice_date,release_status=p_release_status,electronic_release_no=nullif(trim(p_electronic_release_no),'') WHERE id=v_shipment AND organization_id=v_org;
  END IF;
  RETURN v_shipment;
END; $$;

REVOKE ALL ON FUNCTION public.update_shipment_maritime_data(uuid,text,text,smallint,text,text,text,text,text,text,numeric,text,numeric,numeric,text,text,date,text,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.update_shipment_maritime_data(uuid,text,text,smallint,text,text,text,text,text,text,numeric,text,numeric,numeric,text,text,date,text,text,uuid) TO authenticated;
