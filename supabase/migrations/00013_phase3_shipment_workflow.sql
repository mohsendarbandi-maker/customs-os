ALTER TABLE public.shipments
  ADD COLUMN IF NOT EXISTS shipping_line text,
  ADD COLUMN IF NOT EXISTS bill_of_lading_year smallint;

UPDATE public.shipments
SET shipping_line = 'UNKNOWN',
    bill_of_lading_year = EXTRACT(YEAR FROM created_at)::smallint
WHERE shipping_line IS NULL OR bill_of_lading_year IS NULL;

ALTER TABLE public.shipments
  ALTER COLUMN shipping_line SET NOT NULL,
  ALTER COLUMN bill_of_lading_year SET NOT NULL;

ALTER TABLE public.shipments
  ADD CONSTRAINT shipments_bill_of_lading_year_check
  CHECK (bill_of_lading_year BETWEEN 2000 AND 2100);

CREATE UNIQUE INDEX IF NOT EXISTS uq_shipments_bl_line_year
ON public.shipments (
  organization_id,
  lower(trim(shipping_line)),
  lower(trim(bill_of_lading_no)),
  bill_of_lading_year
)
WHERE bill_of_lading_no IS NOT NULL AND trim(bill_of_lading_no) <> '';

CREATE OR REPLACE FUNCTION public.register_shipment_workflow(
  p_case_id uuid,
  p_shipping_line text,
  p_bill_of_lading_no text,
  p_bill_of_lading_year smallint,
  p_vessel_name text,
  p_gross_weight_kg numeric,
  p_transport_mode public.transport_mode DEFAULT 'sea'::public.transport_mode
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org_id uuid;
  v_vessel_id uuid;
  v_shipment_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  v_org_id := public.user_org_id();
  IF v_org_id IS NULL THEN RAISE EXCEPTION 'User organization not found'; END IF;
  IF public.user_role() NOT IN ('owner','admin','broker') THEN RAISE EXCEPTION 'User role is not allowed to register shipments'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.cases c WHERE c.id = p_case_id AND c.organization_id = v_org_id) THEN RAISE EXCEPTION 'Case not found or access denied'; END IF;
  IF nullif(trim(p_shipping_line), '') IS NULL THEN RAISE EXCEPTION 'Shipping line is required'; END IF;
  IF nullif(trim(p_bill_of_lading_no), '') IS NULL THEN RAISE EXCEPTION 'Bill of Lading number is required'; END IF;
  IF p_bill_of_lading_year IS NULL OR p_bill_of_lading_year NOT BETWEEN 2000 AND 2100 THEN RAISE EXCEPTION 'Bill of Lading year is invalid'; END IF;
  IF p_gross_weight_kg IS NULL OR p_gross_weight_kg <= 0 THEN RAISE EXCEPTION 'Gross weight must be greater than zero'; END IF;
  IF p_transport_mode = 'sea' AND nullif(trim(p_vessel_name), '') IS NULL THEN RAISE EXCEPTION 'Vessel name is required for sea shipments'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.shipments s
    WHERE s.organization_id = v_org_id
      AND lower(trim(s.shipping_line)) = lower(trim(p_shipping_line))
      AND lower(trim(s.bill_of_lading_no)) = lower(trim(p_bill_of_lading_no))
      AND s.bill_of_lading_year = p_bill_of_lading_year
  ) THEN
    RAISE EXCEPTION 'Duplicate B/L: this B/L number already exists for this shipping line in this year';
  END IF;
  IF p_vessel_name IS NOT NULL AND trim(p_vessel_name) <> '' THEN
    SELECT v.id INTO v_vessel_id FROM public.vessels v
    WHERE v.organization_id = v_org_id AND lower(trim(v.name)) = lower(trim(p_vessel_name))
    ORDER BY v.created_at LIMIT 1;
    IF v_vessel_id IS NULL THEN
      INSERT INTO public.vessels (organization_id, name) VALUES (v_org_id, trim(p_vessel_name)) RETURNING id INTO v_vessel_id;
    END IF;
  END IF;
  INSERT INTO public.shipments (
    organization_id, case_id, vessel_id, shipping_line, bill_of_lading_no,
    bill_of_lading_year, gross_weight_kg, transport_mode
  ) VALUES (
    v_org_id, p_case_id, v_vessel_id, trim(p_shipping_line), trim(p_bill_of_lading_no),
    p_bill_of_lading_year, p_gross_weight_kg, p_transport_mode
  ) RETURNING id INTO v_shipment_id;
  RETURN v_shipment_id;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'Duplicate B/L: this B/L number already exists for this shipping line in this year';
END;
$$;

REVOKE ALL ON FUNCTION public.register_shipment_workflow(uuid,text,text,smallint,text,numeric,public.transport_mode) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.register_shipment_workflow(uuid,text,text,smallint,text,numeric,public.transport_mode) FROM anon;
GRANT EXECUTE ON FUNCTION public.register_shipment_workflow(uuid,text,text,smallint,text,numeric,public.transport_mode) TO authenticated;
