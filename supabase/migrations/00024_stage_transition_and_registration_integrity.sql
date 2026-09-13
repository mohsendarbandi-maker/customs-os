-- Phase 24: enforce forward-only case stage transitions and safe independent registration-order defaults.

ALTER TABLE public.registration_orders
  ALTER COLUMN organization_id SET DEFAULT public.user_org_id();

CREATE OR REPLACE FUNCTION public.registration_order_set_tenant_and_case_client()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF NEW.organization_id IS NULL THEN NEW.organization_id := public.user_org_id(); END IF;
  IF NEW.organization_id <> public.user_org_id() THEN RAISE EXCEPTION 'Organization mismatch'; END IF;
  IF NEW.case_id IS NOT NULL THEN
    SELECT c.client_id INTO NEW.client_id FROM public.cases c
    WHERE c.id = NEW.case_id AND c.organization_id = NEW.organization_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Case not found or access denied'; END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_registration_order_tenant_client ON public.registration_orders;
CREATE TRIGGER tr_registration_order_tenant_client
BEFORE INSERT OR UPDATE ON public.registration_orders
FOR EACH ROW EXECUTE FUNCTION public.registration_order_set_tenant_and_case_client();

REVOKE ALL ON FUNCTION public.registration_order_set_tenant_and_case_client() FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.advance_case_stage(
  p_case_id uuid,
  p_target_status public.case_status,
  p_notes text DEFAULT NULL
)
RETURNS public.case_status
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org_id uuid := public.user_org_id();
  v_current public.case_status;
  v_ready jsonb;
  v_allowed boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF v_org_id IS NULL OR public.user_role() NOT IN ('owner','admin','broker') THEN
    RAISE EXCEPTION 'User is not allowed to advance case stage';
  END IF;

  SELECT c.status INTO v_current
  FROM public.cases c
  WHERE c.id = p_case_id AND c.organization_id = v_org_id;
  IF v_current IS NULL THEN RAISE EXCEPTION 'Case not found or access denied'; END IF;
  IF p_target_status = v_current THEN RETURN v_current; END IF;

  v_allowed := CASE v_current
    WHEN 'draft' THEN p_target_status IN ('registration_order','documents_ready')
    WHEN 'registration_order' THEN p_target_status = 'documents_ready'
    WHEN 'documents_ready' THEN p_target_status = 'epl_submitted'
    WHEN 'epl_submitted' THEN p_target_status = 'kottaj_received'
    WHEN 'kottaj_received' THEN p_target_status IN ('path_green','path_yellow','path_red')
    WHEN 'path_green' THEN p_target_status = 'valuation'
    WHEN 'path_yellow' THEN p_target_status = 'valuation'
    WHEN 'path_red' THEN p_target_status = 'valuation'
    WHEN 'valuation' THEN p_target_status = 'duties_calculation'
    WHEN 'duties_calculation' THEN p_target_status = 'exit_permit'
    WHEN 'exit_permit' THEN p_target_status = 'completed'
    WHEN 'completed' THEN p_target_status = 'archived'
    ELSE false
  END;

  IF NOT v_allowed THEN
    RAISE EXCEPTION 'انتقال مرحله غیرمجاز است: % → %', v_current, p_target_status;
  END IF;

  IF p_target_status = 'completed' THEN
    v_ready := public.get_case_completion_readiness(p_case_id);
    IF NOT COALESCE((v_ready->>'ready')::boolean, false) THEN
      RAISE EXCEPTION 'پرونده آماده تکمیل نیست: %', v_ready->>'issues';
    END IF;
  END IF;

  UPDATE public.cases
  SET status = p_target_status, updated_at = now()
  WHERE id = p_case_id AND organization_id = v_org_id;

  INSERT INTO public.case_status_history(
    organization_id, case_id, previous_status, new_status, notes, changed_by
  ) VALUES (
    v_org_id, p_case_id, v_current, p_target_status,
    NULLIF(trim(p_notes), ''), auth.uid()
  );

  RETURN p_target_status;
END;
$$;

REVOKE ALL ON FUNCTION public.advance_case_stage(uuid,public.case_status,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.advance_case_stage(uuid,public.case_status,text) TO authenticated;
