-- Owner-aware maritime records, numeric EPL username, destructive delete workflows.

ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS client_id uuid;
ALTER TABLE public.shipments DROP CONSTRAINT IF EXISTS fk_shipments_client_tenant;
ALTER TABLE public.shipments ADD CONSTRAINT fk_shipments_client_tenant
  FOREIGN KEY (client_id, organization_id) REFERENCES public.clients(id, organization_id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_shipments_client_id ON public.shipments(organization_id, client_id);

ALTER TABLE public.client_epl_credentials DROP CONSTRAINT IF EXISTS client_epl_username_numeric_chk;
ALTER TABLE public.client_epl_credentials ADD CONSTRAINT client_epl_username_numeric_chk CHECK (epl_username ~ '^[0-9]+$');

DROP FUNCTION IF EXISTS public.update_shipment_maritime_data(uuid,text,text,smallint,text,text,text,text,text,text,numeric,text,numeric,numeric,text,text,date,text,text);
CREATE OR REPLACE FUNCTION public.update_shipment_maritime_data(
  p_case_id uuid, p_shipping_line text, p_bill_of_lading_no text, p_bill_of_lading_year smallint,
  p_vessel_name text, p_vessel_imo text DEFAULT NULL, p_vessel_flag_code text DEFAULT NULL,
  p_voyage_no text DEFAULT NULL, p_origin_port text DEFAULT NULL, p_destination_port text DEFAULT NULL,
  p_cargo_count numeric DEFAULT NULL, p_cargo_count_unit text DEFAULT NULL, p_net_weight_kg numeric DEFAULT NULL,
  p_gross_weight_kg numeric DEFAULT NULL, p_tally_no text DEFAULT NULL, p_release_invoice_no text DEFAULT NULL,
  p_release_invoice_date date DEFAULT NULL, p_release_status text DEFAULT NULL,
  p_electronic_release_no text DEFAULT NULL, p_client_id uuid DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_org uuid; v_shipment uuid; v_vessel uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  v_org:=public.user_org_id();
  IF v_org IS NULL OR public.user_role() NOT IN ('owner','admin','broker') THEN RAISE EXCEPTION 'Insufficient access'; END IF;
  IF p_case_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.cases WHERE id=p_case_id AND organization_id=v_org) THEN RAISE EXCEPTION 'Case not found or access denied'; END IF;
  IF p_client_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.clients WHERE id=p_client_id AND organization_id=v_org) THEN RAISE EXCEPTION 'Cargo owner not found or access denied'; END IF;
  IF NULLIF(trim(p_shipping_line),'') IS NULL THEN RAISE EXCEPTION 'Shipping line is required'; END IF;
  IF NULLIF(trim(p_bill_of_lading_no),'') IS NULL THEN RAISE EXCEPTION 'B/L number is required'; END IF;
  IF p_bill_of_lading_year < 2000 OR p_bill_of_lading_year > 2100 THEN RAISE EXCEPTION 'Invalid B/L year'; END IF;
  IF NULLIF(trim(p_vessel_name),'') IS NULL THEN RAISE EXCEPTION 'Vessel name is required'; END IF;
  IF p_gross_weight_kg IS NOT NULL AND p_gross_weight_kg <= 0 THEN RAISE EXCEPTION 'Gross weight must be positive'; END IF;
  IF p_net_weight_kg IS NOT NULL AND p_net_weight_kg < 0 THEN RAISE EXCEPTION 'Net weight cannot be negative'; END IF;
  IF p_vessel_imo IS NOT NULL AND trim(p_vessel_imo)<>'' AND trim(p_vessel_imo) !~ '^[0-9]{7}$' THEN RAISE EXCEPTION 'IMO number must contain 7 digits'; END IF;
  IF p_vessel_flag_code IS NOT NULL AND trim(p_vessel_flag_code)<>'' AND upper(trim(p_vessel_flag_code)) !~ '^[A-Z]{2}$' THEN RAISE EXCEPTION 'Vessel flag must be a 2-letter ISO country code'; END IF;
  SELECT id INTO v_vessel FROM public.vessels WHERE organization_id=v_org AND lower(trim(name))=lower(trim(p_vessel_name)) LIMIT 1;
  IF v_vessel IS NULL THEN
    INSERT INTO public.vessels(organization_id,name,imo_number,flag_code,flag) VALUES(v_org,trim(p_vessel_name),NULLIF(trim(p_vessel_imo),''),upper(NULLIF(trim(p_vessel_flag_code),'')),upper(NULLIF(trim(p_vessel_flag_code),''))) RETURNING id INTO v_vessel;
  ELSE
    UPDATE public.vessels SET imo_number=coalesce(NULLIF(trim(p_vessel_imo),''),imo_number),flag_code=coalesce(upper(NULLIF(trim(p_vessel_flag_code),'')),flag_code),flag=coalesce(upper(NULLIF(trim(p_vessel_flag_code),'')),flag) WHERE id=v_vessel AND organization_id=v_org;
  END IF;
  SELECT id INTO v_shipment FROM public.shipments WHERE organization_id=v_org AND bill_of_lading_year=p_bill_of_lading_year AND lower(trim(shipping_line))=lower(trim(p_shipping_line)) AND lower(trim(bill_of_lading_no))=lower(trim(p_bill_of_lading_no)) LIMIT 1;
  IF v_shipment IS NULL THEN
    INSERT INTO public.shipments(organization_id,case_id,client_id,vessel_id,transport_mode,bill_of_lading_no,bill_of_lading_year,shipping_line,gross_weight_kg,origin_port,destination_port,voyage_no,cargo_count,cargo_count_unit,net_weight_kg,tally_no,release_invoice_no,release_invoice_date,release_status,electronic_release_no,current_status)
    VALUES(v_org,p_case_id,p_client_id,v_vessel,'sea',trim(p_bill_of_lading_no),p_bill_of_lading_year,trim(p_shipping_line),coalesce(p_gross_weight_kg,1),NULLIF(trim(p_origin_port),''),NULLIF(trim(p_destination_port),''),NULLIF(trim(p_voyage_no),''),p_cargo_count,NULLIF(trim(p_cargo_count_unit),''),p_net_weight_kg,NULLIF(trim(p_tally_no),''),NULLIF(trim(p_release_invoice_no),''),p_release_invoice_date,p_release_status,NULLIF(trim(p_electronic_release_no),''),'draft') RETURNING id INTO v_shipment;
  ELSE
    UPDATE public.shipments SET case_id=coalesce(p_case_id,case_id),client_id=coalesce(p_client_id,client_id),vessel_id=v_vessel,shipping_line=trim(p_shipping_line),voyage_no=NULLIF(trim(p_voyage_no),''),origin_port=NULLIF(trim(p_origin_port),''),destination_port=NULLIF(trim(p_destination_port),''),cargo_count=p_cargo_count,cargo_count_unit=NULLIF(trim(p_cargo_count_unit),''),net_weight_kg=p_net_weight_kg,gross_weight_kg=coalesce(p_gross_weight_kg,gross_weight_kg),tally_no=NULLIF(trim(p_tally_no),''),release_invoice_no=NULLIF(trim(p_release_invoice_no),''),release_invoice_date=p_release_invoice_date,release_status=p_release_status,electronic_release_no=NULLIF(trim(p_electronic_release_no),'') WHERE id=v_shipment AND organization_id=v_org;
  END IF;
  RETURN v_shipment;
END; $$;
REVOKE ALL ON FUNCTION public.update_shipment_maritime_data(uuid,text,text,smallint,text,text,text,text,text,text,numeric,text,numeric,numeric,text,text,date,text,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.update_shipment_maritime_data(uuid,text,text,smallint,text,text,text,text,text,text,numeric,text,numeric,numeric,text,text,date,text,text,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_client_workflow(p_client_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_org uuid; v_case_ids uuid[]; v_shipment_ids uuid[];
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  v_org:=public.user_org_id();
  IF v_org IS NULL OR public.user_role() NOT IN ('owner','admin','broker') THEN RAISE EXCEPTION 'Insufficient access'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.clients WHERE id=p_client_id AND organization_id=v_org) THEN RAISE EXCEPTION 'Cargo owner not found'; END IF;
  SELECT coalesce(array_agg(id),'{}') INTO v_case_ids FROM public.cases WHERE client_id=p_client_id AND organization_id=v_org;
  SELECT coalesce(array_agg(id),'{}') INTO v_shipment_ids FROM public.shipments WHERE client_id=p_client_id AND organization_id=v_org;
  IF cardinality(v_shipment_ids)>0 THEN
    DELETE FROM public.shipment_tracking_events WHERE shipment_id=ANY(v_shipment_ids) AND organization_id=v_org;
    DELETE FROM public.containers WHERE shipment_id=ANY(v_shipment_ids) AND organization_id=v_org;
    DELETE FROM public.audit_logs WHERE record_id=ANY(v_shipment_ids) AND organization_id=v_org;
    DELETE FROM public.shipments WHERE id=ANY(v_shipment_ids) AND organization_id=v_org;
  END IF;
  IF cardinality(v_case_ids)>0 THEN
    DELETE FROM public.registration_orders WHERE case_id=ANY(v_case_ids) AND organization_id=v_org;
    DELETE FROM public.customs_declarations WHERE case_id=ANY(v_case_ids) AND organization_id=v_org;
    DELETE FROM public.permits WHERE case_id=ANY(v_case_ids) AND organization_id=v_org;
    DELETE FROM public.financial_transactions WHERE case_id=ANY(v_case_ids) AND organization_id=v_org;
    DELETE FROM public.documents WHERE case_id=ANY(v_case_ids) AND organization_id=v_org;
    DELETE FROM public.case_status_history WHERE case_id=ANY(v_case_ids) AND organization_id=v_org;
    DELETE FROM public.audit_logs WHERE record_id=ANY(v_case_ids) AND organization_id=v_org;
    UPDATE public.profiles SET client_id=NULL WHERE client_id=p_client_id AND organization_id=v_org;
    DELETE FROM public.cases WHERE id=ANY(v_case_ids) AND organization_id=v_org;
  END IF;
  DELETE FROM public.client_epl_credentials WHERE client_id=p_client_id AND organization_id=v_org;
  UPDATE public.profiles SET client_id=NULL WHERE client_id=p_client_id AND organization_id=v_org;
  DELETE FROM public.audit_logs WHERE record_id=p_client_id AND organization_id=v_org;
  DELETE FROM public.clients WHERE id=p_client_id AND organization_id=v_org;
END; $$;
REVOKE ALL ON FUNCTION public.delete_client_workflow(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.delete_client_workflow(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_shipment_workflow(p_shipment_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_org uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  v_org:=public.user_org_id();
  IF v_org IS NULL OR public.user_role() NOT IN ('owner','admin','broker') THEN RAISE EXCEPTION 'Insufficient access'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.shipments WHERE id=p_shipment_id AND organization_id=v_org) THEN RAISE EXCEPTION 'Shipment not found'; END IF;
  DELETE FROM public.shipment_tracking_events WHERE shipment_id=p_shipment_id AND organization_id=v_org;
  DELETE FROM public.containers WHERE shipment_id=p_shipment_id AND organization_id=v_org;
  DELETE FROM public.audit_logs WHERE record_id=p_shipment_id AND organization_id=v_org;
  DELETE FROM public.shipments WHERE id=p_shipment_id AND organization_id=v_org;
END; $$;
REVOKE ALL ON FUNCTION public.delete_shipment_workflow(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.delete_shipment_workflow(uuid) TO authenticated;
