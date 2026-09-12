-- Phase 3.4: operational case data and maritime base fields.
-- This migration is intentionally before 00017/00018 so a fresh database can replay them in order.

-- Registration order is an independent document/entity and may be attached after case creation.
CREATE OR REPLACE FUNCTION public.attach_registration_order(
  p_case_id uuid,
  p_order_number text,
  p_order_date date DEFAULT NULL,
  p_status text DEFAULT 'received',
  p_tariff_code text DEFAULT NULL,
  p_quantity numeric DEFAULT NULL,
  p_quantity_unit text DEFAULT NULL,
  p_value_amount numeric DEFAULT NULL,
  p_currency currency_code DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org uuid;
  v_reg_id uuid;
  v_case_org uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'authentication required'; END IF;
  v_org := public.user_org_id();
  IF public.user_role() NOT IN ('owner','admin','broker') THEN RAISE EXCEPTION 'insufficient role'; END IF;
  IF nullif(trim(p_order_number),'') IS NULL THEN RAISE EXCEPTION 'registration order number is required'; END IF;
  SELECT organization_id INTO v_case_org FROM public.cases WHERE id=p_case_id;
  IF v_case_org IS NULL OR v_case_org <> v_org THEN RAISE EXCEPTION 'case not found'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.registration_orders
    WHERE organization_id=v_org AND order_number=trim(p_order_number)
      AND (case_id IS NULL OR case_id<>p_case_id)
  ) THEN RAISE EXCEPTION 'registration order already exists in this organization: %', trim(p_order_number); END IF;

  INSERT INTO public.registration_orders(
    organization_id,case_id,order_number,order_date,status,tariff_code,quantity,quantity_unit,value_amount,currency,notes
  ) VALUES (
    v_org,p_case_id,trim(p_order_number),p_order_date,coalesce(p_status,'received'),
    nullif(trim(p_tariff_code),''),p_quantity,nullif(trim(p_quantity_unit),''),p_value_amount,p_currency,p_notes
  )
  ON CONFLICT (organization_id,order_number) DO UPDATE SET
    case_id=excluded.case_id,
    order_date=coalesce(excluded.order_date,registration_orders.order_date),
    status=excluded.status,
    tariff_code=coalesce(excluded.tariff_code,registration_orders.tariff_code),
    quantity=coalesce(excluded.quantity,registration_orders.quantity),
    quantity_unit=coalesce(excluded.quantity_unit,registration_orders.quantity_unit),
    value_amount=coalesce(excluded.value_amount,registration_orders.value_amount),
    currency=coalesce(excluded.currency,registration_orders.currency),
    notes=coalesce(excluded.notes,registration_orders.notes),
    updated_at=now()
  RETURNING id INTO v_reg_id;

  UPDATE public.cases
  SET registration_order_no=trim(p_order_number), updated_at=now()
  WHERE id=p_case_id AND organization_id=v_org;

  IF (SELECT status FROM public.cases WHERE id=p_case_id)='draft' THEN
    UPDATE public.cases SET status='registration_order'
    WHERE id=p_case_id AND organization_id=v_org;
  END IF;
  RETURN v_reg_id;
END;
$$;

REVOKE ALL ON FUNCTION public.attach_registration_order(uuid,text,date,text,text,numeric,text,numeric,currency_code,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.attach_registration_order(uuid,text,date,text,text,numeric,text,numeric,currency_code,text) FROM anon;
GRANT EXECUTE ON FUNCTION public.attach_registration_order(uuid,text,date,text,text,numeric,text,numeric,currency_code,text) TO authenticated;

-- Maritime operational fields required by the draft B/L / shipping file workflow.
ALTER TABLE public.vessels
  ADD COLUMN IF NOT EXISTS imo_number varchar(20),
  ADD COLUMN IF NOT EXISTS flag_code char(2);

ALTER TABLE public.shipments
  ADD COLUMN IF NOT EXISTS voyage_no text,
  ADD COLUMN IF NOT EXISTS cargo_count numeric,
  ADD COLUMN IF NOT EXISTS cargo_count_unit text,
  ADD COLUMN IF NOT EXISTS net_weight_kg numeric,
  ADD COLUMN IF NOT EXISTS tally_no text,
  ADD COLUMN IF NOT EXISTS release_invoice_no text,
  ADD COLUMN IF NOT EXISTS release_invoice_date date,
  ADD COLUMN IF NOT EXISTS release_status text,
  ADD COLUMN IF NOT EXISTS electronic_release_no text,
  ADD COLUMN IF NOT EXISTS current_status text NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS current_location text,
  ADD COLUMN IF NOT EXISTS eta_destination timestamptz,
  ADD COLUMN IF NOT EXISTS etd_origin timestamptz,
  ADD COLUMN IF NOT EXISTS actual_departure_at timestamptz,
  ADD COLUMN IF NOT EXISTS actual_arrival_at timestamptz,
  ADD COLUMN IF NOT EXISTS actual_loading_start_at timestamptz,
  ADD COLUMN IF NOT EXISTS actual_loading_end_at timestamptz,
  ADD COLUMN IF NOT EXISTS actual_discharge_start_at timestamptz,
  ADD COLUMN IF NOT EXISTS actual_discharge_end_at timestamptz;

ALTER TABLE public.shipments
  DROP CONSTRAINT IF EXISTS shipments_maritime_numeric_check;
ALTER TABLE public.shipments
  ADD CONSTRAINT shipments_maritime_numeric_check CHECK (
    (cargo_count IS NULL OR cargo_count >= 0) AND
    (net_weight_kg IS NULL OR net_weight_kg >= 0) AND
    (gross_weight_kg IS NULL OR gross_weight_kg >= 0)
  );

ALTER TABLE public.vessels
  DROP CONSTRAINT IF EXISTS vessels_imo_number_check;
ALTER TABLE public.vessels
  ADD CONSTRAINT vessels_imo_number_check CHECK (imo_number IS NULL OR imo_number ~ '^[0-9]{7}$');

ALTER TABLE public.vessels
  DROP CONSTRAINT IF EXISTS vessels_flag_code_check;
ALTER TABLE public.vessels
  ADD CONSTRAINT vessels_flag_code_check CHECK (flag_code IS NULL OR flag_code ~ '^[A-Z]{2}$');

CREATE INDEX IF NOT EXISTS idx_shipments_case ON public.shipments(organization_id, case_id);
CREATE INDEX IF NOT EXISTS idx_shipments_status ON public.shipments(organization_id, current_status);
