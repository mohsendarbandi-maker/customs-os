-- Phase 3.1: case workflow.
-- Registration order is optional at case creation and can be attached later.

CREATE OR REPLACE FUNCTION public.create_case_workflow(
  p_client_name text,
  p_registration_order_no text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org_id uuid;
  v_client_id uuid;
  v_case_id uuid;
  v_case_number text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  v_org_id := public.user_org_id();
  IF v_org_id IS NULL THEN RAISE EXCEPTION 'User organization not found'; END IF;
  IF public.user_role() NOT IN ('owner','admin','broker') THEN
    RAISE EXCEPTION 'User role is not allowed to create cases';
  END IF;
  IF nullif(trim(p_client_name), '') IS NULL THEN
    RAISE EXCEPTION 'Client name is required';
  END IF;

  IF nullif(trim(p_registration_order_no), '') IS NOT NULL THEN
    SELECT c.id INTO v_case_id
    FROM public.cases c
    WHERE c.organization_id = v_org_id
      AND c.registration_order_no = trim(p_registration_order_no)
    ORDER BY c.created_at
    LIMIT 1;
    IF v_case_id IS NOT NULL THEN RETURN v_case_id; END IF;
  END IF;

  SELECT c.id INTO v_client_id
  FROM public.clients c
  WHERE c.organization_id = v_org_id
    AND lower(trim(c.name)) = lower(trim(p_client_name))
  ORDER BY c.created_at
  LIMIT 1;

  IF v_client_id IS NULL THEN
    INSERT INTO public.clients (organization_id, name)
    VALUES (v_org_id, trim(p_client_name))
    RETURNING id INTO v_client_id;
  END IF;

  v_case_number := 'CASE-' || to_char(clock_timestamp(), 'YYYYMMDD-HH24MISS') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));

  INSERT INTO public.cases (
    organization_id, client_id, case_number, status, registration_order_no
  ) VALUES (
    v_org_id, v_client_id, v_case_number, 'draft',
    nullif(trim(p_registration_order_no), '')
  ) RETURNING id INTO v_case_id;

  IF nullif(trim(p_registration_order_no), '') IS NOT NULL THEN
    UPDATE public.cases SET status = 'registration_order'
    WHERE id = v_case_id;
  END IF;

  RETURN v_case_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_case_workflow(text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_case_workflow(text,text) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_case_workflow(text,text) TO authenticated;
