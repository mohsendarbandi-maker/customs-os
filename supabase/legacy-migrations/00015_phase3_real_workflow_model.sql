-- Phase 3.5: align the database with the real customs clearance workflow.
-- The workflow is intentionally document-first: pre-arrival -> discharge -> release -> document pack -> valuation -> EPL/kottaj -> permits -> payment -> exit.

-- 1) The current customs_offices reference table is global (its schema has no organization_id).
--    Do not use a tenant predicate against it.
--    The declaration workflow is corrected below.

-- 2) Add operational data that exists in the real file but was missing from the first model.
ALTER TABLE public.cases
  ADD COLUMN IF NOT EXISTS vessel_type text,
  ADD COLUMN IF NOT EXISTS unloading_date date,
  ADD COLUMN IF NOT EXISTS warehouse_receipt_no text,
  ADD COLUMN IF NOT EXISTS warehouse_receipt_date date,
  ADD COLUMN IF NOT EXISTS release_status text,
  ADD COLUMN IF NOT EXISTS cargo_count numeric,
  ADD COLUMN IF NOT EXISTS cargo_count_unit text,
  ADD COLUMN IF NOT EXISTS cargo_description text,
  ADD COLUMN IF NOT EXISTS origin_country_code char(2),
  ADD COLUMN IF NOT EXISTS transaction_country_code char(2),
  ADD COLUMN IF NOT EXISTS delivery_term text,
  ADD COLUMN IF NOT EXISTS invoice_amount numeric,
  ADD COLUMN IF NOT EXISTS invoice_currency currency_code,
  ADD COLUMN IF NOT EXISTS net_weight_kg numeric,
  ADD COLUMN IF NOT EXISTS gross_weight_kg numeric,
  ADD COLUMN IF NOT EXISTS insurance_amount_irr numeric,
  ADD COLUMN IF NOT EXISTS tariff_code text,
  ADD COLUMN IF NOT EXISTS import_duty_rate numeric,
  ADD COLUMN IF NOT EXISTS customs_fx_rate_irr numeric,
  ADD COLUMN IF NOT EXISTS customs_value_irr numeric,
  ADD COLUMN IF NOT EXISTS import_duty_irr numeric,
  ADD COLUMN IF NOT EXISTS vat_irr numeric,
  ADD COLUMN IF NOT EXISTS total_payable_irr numeric,
  ADD COLUMN IF NOT EXISTS valuation_status text;

ALTER TABLE public.cases
  DROP CONSTRAINT IF EXISTS cases_release_status_check;
ALTER TABLE public.cases
  ADD CONSTRAINT cases_release_status_check
  CHECK (release_status IS NULL OR release_status IN ('pending','invoice_received','paid','released'));

ALTER TABLE public.cases
  DROP CONSTRAINT IF EXISTS cases_valuation_status_check;
ALTER TABLE public.cases
  ADD CONSTRAINT cases_valuation_status_check
  CHECK (valuation_status IS NULL OR valuation_status IN ('pending','calculated','reviewed','approved'));

ALTER TABLE public.cases
  DROP CONSTRAINT IF EXISTS cases_numeric_nonnegative_check;
ALTER TABLE public.cases
  ADD CONSTRAINT cases_numeric_nonnegative_check
  CHECK (
    (cargo_count IS NULL OR cargo_count >= 0) AND
    (invoice_amount IS NULL OR invoice_amount >= 0) AND
    (net_weight_kg IS NULL OR net_weight_kg >= 0) AND
    (gross_weight_kg IS NULL OR gross_weight_kg >= 0) AND
    (insurance_amount_irr IS NULL OR insurance_amount_irr >= 0) AND
    (import_duty_rate IS NULL OR import_duty_rate >= 0) AND
    (customs_fx_rate_irr IS NULL OR customs_fx_rate_irr > 0) AND
    (customs_value_irr IS NULL OR customs_value_irr >= 0) AND
    (import_duty_irr IS NULL OR import_duty_irr >= 0) AND
    (vat_irr IS NULL OR vat_irr >= 0) AND
    (total_payable_irr IS NULL OR total_payable_irr >= 0)
  );

-- 3) Fix declaration registration: kottaj is an EPL output, not an input to the first case.
--    It may be attached only after EPL submission has produced the number.
CREATE OR REPLACE FUNCTION public.register_declaration_workflow(
  p_case_id uuid,
  p_kottaj_number text,
  p_declaration_date timestamptz DEFAULT now(),
  p_customs_office_id uuid DEFAULT NULL,
  p_customs_path text DEFAULT NULL,
  p_assessed_value_irr numeric DEFAULT NULL,
  p_total_duties_irr numeric DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org_id uuid;
  v_declaration_id uuid;
  v_case_org_id uuid;
  v_existing_case_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  v_org_id := user_org_id();
  IF v_org_id IS NULL THEN RAISE EXCEPTION 'User organization not found'; END IF;
  IF user_role() NOT IN ('owner','admin','broker') THEN
    RAISE EXCEPTION 'User role is not allowed to register declarations';
  END IF;
  IF p_case_id IS NULL THEN RAISE EXCEPTION 'Case is required'; END IF;
  IF nullif(trim(p_kottaj_number), '') IS NULL THEN RAISE EXCEPTION 'Kottaj number is required'; END IF;

  SELECT c.organization_id INTO v_case_org_id
  FROM public.cases c WHERE c.id = p_case_id;
  IF v_case_org_id IS NULL THEN RAISE EXCEPTION 'Case not found'; END IF;
  IF v_case_org_id <> v_org_id THEN RAISE EXCEPTION 'Case belongs to another organization'; END IF;
  IF p_declaration_date IS NULL THEN RAISE EXCEPTION 'Declaration date is required'; END IF;
  IF p_assessed_value_irr IS NOT NULL AND p_assessed_value_irr < 0 THEN RAISE EXCEPTION 'Assessed value cannot be negative'; END IF;
  IF p_total_duties_irr IS NOT NULL AND p_total_duties_irr < 0 THEN RAISE EXCEPTION 'Total duties cannot be negative'; END IF;

  IF p_customs_office_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.customs_offices co WHERE co.id = p_customs_office_id
  ) THEN
    RAISE EXCEPTION 'Customs office not found';
  END IF;

  SELECT d.id, d.case_id INTO v_declaration_id, v_existing_case_id
  FROM public.customs_declarations d
  WHERE d.organization_id = v_org_id
    AND lower(trim(d.kottaj_number)) = lower(trim(p_kottaj_number))
  LIMIT 1;

  IF v_declaration_id IS NOT NULL THEN
    IF v_existing_case_id = p_case_id THEN RETURN v_declaration_id; END IF;
    RAISE EXCEPTION 'Kottaj number already exists in this organization';
  END IF;

  INSERT INTO public.customs_declarations (
    organization_id, case_id, customs_office_id, kottaj_number,
    declaration_date, customs_path, assessed_value_irr, total_duties_irr
  ) VALUES (
    v_org_id, p_case_id, p_customs_office_id, trim(p_kottaj_number),
    p_declaration_date, nullif(trim(p_customs_path), ''),
    p_assessed_value_irr, p_total_duties_irr
  ) RETURNING id INTO v_declaration_id;

  UPDATE public.cases
  SET status = CASE
    WHEN p_customs_path = 'green' THEN 'path_green'::case_status
    WHEN p_customs_path = 'yellow' THEN 'path_yellow'::case_status
    WHEN p_customs_path = 'red' THEN 'path_red'::case_status
    ELSE 'kottaj_received'::case_status
  END
  WHERE id = p_case_id AND organization_id = v_org_id;

  RETURN v_declaration_id;
END;
$$;

REVOKE ALL ON FUNCTION public.register_declaration_workflow(uuid,text,timestamptz,uuid,text,numeric,numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.register_declaration_workflow(uuid,text,timestamptz,uuid,text,numeric,numeric) FROM anon;
GRANT EXECUTE ON FUNCTION public.register_declaration_workflow(uuid,text,timestamptz,uuid,text,numeric,numeric) TO authenticated;

-- 4) Atomic valuation calculation for the broker.
--    IMPORTANT: invoice amount is not silently treated as IRR. A valid customs FX rate is required.
CREATE OR REPLACE FUNCTION public.calculate_case_valuation(
  p_case_id uuid,
  p_customs_fx_rate_irr numeric,
  p_import_duty_rate numeric,
  p_vat_rate numeric DEFAULT 10
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org_id uuid;
  v_case public.cases%ROWTYPE;
  v_customs_value numeric;
  v_duty numeric;
  v_vat_base numeric;
  v_vat numeric;
  v_total numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  v_org_id := user_org_id();
  IF v_org_id IS NULL OR user_role() NOT IN ('owner','admin','broker') THEN
    RAISE EXCEPTION 'User is not allowed to calculate valuation';
  END IF;
  IF p_customs_fx_rate_irr IS NULL OR p_customs_fx_rate_irr <= 0 THEN
    RAISE EXCEPTION 'Customs FX rate must be greater than zero';
  END IF;
  IF p_import_duty_rate IS NULL OR p_import_duty_rate < 0 THEN
    RAISE EXCEPTION 'Import duty rate is invalid';
  END IF;
  IF p_vat_rate IS NULL OR p_vat_rate < 0 THEN
    RAISE EXCEPTION 'VAT rate is invalid';
  END IF;

  SELECT * INTO v_case FROM public.cases c
  WHERE c.id = p_case_id AND c.organization_id = v_org_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Case not found or access denied'; END IF;
  IF v_case.invoice_amount IS NULL OR v_case.invoice_amount <= 0 THEN
    RAISE EXCEPTION 'Invoice amount is required before valuation';
  END IF;
  IF v_case.invoice_currency IS NULL THEN
    RAISE EXCEPTION 'Invoice currency is required before valuation';
  END IF;
  IF v_case.insurance_amount_irr IS NULL THEN
    RAISE EXCEPTION 'Insurance amount in IRR is required before valuation';
  END IF;

  v_customs_value := CASE
    WHEN v_case.invoice_currency = 'IRR'::currency_code THEN v_case.invoice_amount
    ELSE v_case.invoice_amount * p_customs_fx_rate_irr
  END + v_case.insurance_amount_irr;

  v_duty := v_customs_value * p_import_duty_rate / 100;
  v_vat_base := v_customs_value + v_duty;
  v_vat := v_vat_base * p_vat_rate / 100;
  v_total := v_duty + v_vat;

  UPDATE public.cases
  SET customs_fx_rate_irr = p_customs_fx_rate_irr,
      import_duty_rate = p_import_duty_rate,
      customs_value_irr = v_customs_value,
      import_duty_irr = v_duty,
      vat_irr = v_vat,
      total_payable_irr = v_total,
      valuation_status = 'calculated',
      status = 'duties_calculation'::case_status
  WHERE id = p_case_id AND organization_id = v_org_id;

  RETURN jsonb_build_object(
    'case_id', p_case_id,
    'customs_value_irr', v_customs_value,
    'import_duty_irr', v_duty,
    'vat_irr', v_vat,
    'total_payable_irr', v_total,
    'fx_rate_irr', p_customs_fx_rate_irr,
    'import_duty_rate', p_import_duty_rate,
    'vat_rate', p_vat_rate
  );
END;
$$;

REVOKE ALL ON FUNCTION public.calculate_case_valuation(uuid,numeric,numeric,numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.calculate_case_valuation(uuid,numeric,numeric,numeric) FROM anon;
GRANT EXECUTE ON FUNCTION public.calculate_case_valuation(uuid,numeric,numeric,numeric) TO authenticated;
