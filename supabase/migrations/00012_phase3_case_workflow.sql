-- ============================================================
-- 00012 PHASE 3 CASE WORKFLOW
-- Atomic creation of client + customs case from the authenticated app.
-- SECURITY INVOKER: RLS remains the authorization boundary.
-- ============================================================

CREATE OR REPLACE FUNCTION public.create_case_workflow(
  p_client_name text,
  p_registration_order_no text
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
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  v_org_id := user_org_id();

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'User organization not found';
  END IF;

  IF user_role() NOT IN ('owner','admin','broker') THEN
    RAISE EXCEPTION 'User role is not allowed to create cases';
  END IF;

  IF nullif(trim(p_client_name), '') IS NULL THEN
    RAISE EXCEPTION 'Client name is required';
  END IF;

  IF nullif(trim(p_registration_order_no), '') IS NULL THEN
    RAISE EXCEPTION 'Registration order number is required';
  END IF;

  -- Idempotency: if this registration order is already attached to a case
  -- in the current organization, return the existing case instead of creating
  -- a duplicate when the user presses Save more than once.
  SELECT c.id
    INTO v_case_id
    FROM public.cases c
   WHERE c.organization_id = v_org_id
     AND c.registration_order_no = trim(p_registration_order_no)
   ORDER BY c.created_at
   LIMIT 1;

  IF v_case_id IS NOT NULL THEN
    RETURN v_case_id;
  END IF;

  SELECT c.id
    INTO v_client_id
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
    organization_id,
    client_id,
    case_number,
    status,
    registration_order_no
  )
  VALUES (
    v_org_id,
    v_client_id,
    v_case_number,
    'draft',
    trim(p_registration_order_no)
  )
  RETURNING id INTO v_case_id;

  -- Move immediately to the first real workflow stage. The existing
  -- status-audit trigger records draft -> registration_order in history.
  UPDATE public.cases
     SET status = 'registration_order'
   WHERE id = v_case_id;

  RETURN v_case_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_case_workflow(text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_case_workflow(text,text) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_case_workflow(text,text) TO authenticated;
