ALTER TABLE public.customs_declarations
  ADD CONSTRAINT uq_customs_declarations_tenant_kottaj UNIQUE (organization_id, kottaj_number);

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
    SELECT 1 FROM public.customs_offices co
    WHERE co.id = p_customs_office_id AND co.organization_id = v_org_id
  ) THEN RAISE EXCEPTION 'Customs office not found in current organization'; END IF;

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
  SET status = 'submitted_epl'
  WHERE id = p_case_id AND organization_id = v_org_id;

  RETURN v_declaration_id;
END;
$$;

REVOKE ALL ON FUNCTION public.register_declaration_workflow(uuid,text,timestamptz,uuid,text,numeric,numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.register_declaration_workflow(uuid,text,timestamptz,uuid,text,numeric,numeric) FROM anon;
GRANT EXECUTE ON FUNCTION public.register_declaration_workflow(uuid,text,timestamptz,uuid,text,numeric,numeric) TO authenticated;
