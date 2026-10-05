-- 00021: Reconstruct the release workflow functions in repository migration history.
-- EPL password plaintext is never returned to the browser.

CREATE OR REPLACE FUNCTION public.get_case_completion_readiness(p_case_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  v_org_id uuid := public.user_org_id(); v_case record; v_pending_permits integer;
  v_decl boolean; v_valuation boolean; v_exit text; v_issues jsonb := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT id,organization_id,status,warehouse_receipt_no,release_status,net_weight_kg,gross_weight_kg INTO v_case
  FROM public.cases WHERE id=p_case_id AND organization_id=v_org_id;
  IF v_case.id IS NULL THEN RAISE EXCEPTION 'Case not found or access denied'; END IF;
  v_decl:=EXISTS(SELECT 1 FROM public.customs_declarations d WHERE d.case_id=p_case_id AND NULLIF(trim(d.kottaj_number),'') IS NOT NULL);
  v_valuation:=COALESCE((SELECT c.valuation_status='calculated' FROM public.cases c WHERE c.id=p_case_id),false);
  v_pending_permits:=(SELECT count(*)::integer FROM public.permits p WHERE p.case_id=p_case_id AND p.status='pending');
  v_exit:=(SELECT e.exit_status FROM public.case_exit_operations e WHERE e.case_id=p_case_id LIMIT 1);
  IF NOT v_decl THEN v_issues:=v_issues||jsonb_build_array('اظهار/کوتاژ ثبت نشده'); END IF;
  IF v_case.warehouse_receipt_no IS NULL AND v_case.release_status IS NULL THEN v_issues:=v_issues||jsonb_build_array('قبض انبار یا وضعیت ترخیصیه ناقص است'); END IF;
  IF v_case.net_weight_kg IS NULL OR v_case.gross_weight_kg IS NULL THEN v_issues:=v_issues||jsonb_build_array('وزن خالص و ناخالص ناقص است'); END IF;
  IF NOT v_valuation THEN v_issues:=v_issues||jsonb_build_array('ارزش‌گذاری محاسبه نشده'); END IF;
  IF v_pending_permits>0 THEN v_issues:=v_issues||jsonb_build_array(format('%s مجوز در انتظار تعیین تکلیف است',v_pending_permits)); END IF;
  IF COALESCE(v_exit,'pending')<>'exited' THEN v_issues:=v_issues||jsonb_build_array('خروج نهایی کالا ثبت نشده'); END IF;
  RETURN jsonb_build_object('case_id',p_case_id,'status',v_case.status,'ready',jsonb_array_length(v_issues)=0,'issues',v_issues,'declaration_ready',v_decl,'valuation_ready',v_valuation,'pending_permits',v_pending_permits,'exit_status',COALESCE(v_exit,'pending'));
END; $$;
REVOKE ALL ON FUNCTION public.get_case_completion_readiness(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_case_completion_readiness(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.advance_case_stage(p_case_id uuid,p_target_status public.case_status,p_notes text DEFAULT NULL)
RETURNS public.case_status LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE v_org_id uuid:=public.user_org_id(); v_current public.case_status; v_ready jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF v_org_id IS NULL OR public.user_role() NOT IN ('owner','admin','broker') THEN RAISE EXCEPTION 'User is not allowed to advance case stage'; END IF;
  SELECT c.status INTO v_current FROM public.cases c WHERE c.id=p_case_id AND c.organization_id=v_org_id;
  IF v_current IS NULL THEN RAISE EXCEPTION 'Case not found or access denied'; END IF;
  IF p_target_status='completed' THEN
    v_ready:=public.get_case_completion_readiness(p_case_id);
    IF NOT COALESCE((v_ready->>'ready')::boolean,false) THEN RAISE EXCEPTION 'پرونده آماده تکمیل نیست: %',v_ready->>'issues'; END IF;
  ELSIF p_target_status='archived' AND v_current<>'completed' THEN
    RAISE EXCEPTION 'فقط پرونده تکمیل‌شده قابل بایگانی است';
  END IF;
  IF p_target_status=v_current THEN RETURN v_current; END IF;
  UPDATE public.cases SET status=p_target_status,updated_at=now() WHERE id=p_case_id AND organization_id=v_org_id;
  INSERT INTO public.case_status_history(organization_id,case_id,previous_status,new_status,notes,changed_by)
  VALUES(v_org_id,p_case_id,v_current,p_target_status,NULLIF(trim(p_notes),''),auth.uid());
  RETURN p_target_status;
END; $$;
REVOKE ALL ON FUNCTION public.advance_case_stage(uuid,public.case_status,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.advance_case_stage(uuid,public.case_status,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_customs_os_integrity_report()
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE v_org uuid:=public.user_org_id(); v_issues jsonb:='[]'::jsonb; v_counts jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF v_org IS NULL OR public.user_role() NOT IN ('owner','admin','broker','accountant') THEN RAISE EXCEPTION 'User is not allowed to run integrity report'; END IF;
  v_counts:=jsonb_build_object(
    'organizations',(SELECT count(*) FROM public.organizations WHERE id=v_org),
    'clients',(SELECT count(*) FROM public.clients WHERE organization_id=v_org),
    'cases',(SELECT count(*) FROM public.cases WHERE organization_id=v_org),
    'shipments',(SELECT count(*) FROM public.shipments WHERE organization_id=v_org),
    'declarations',(SELECT count(*) FROM public.customs_declarations WHERE organization_id=v_org),
    'permits',(SELECT count(*) FROM public.permits WHERE organization_id=v_org),
    'documents',(SELECT count(*) FROM public.documents WHERE organization_id=v_org),
    'finance_transactions',(SELECT count(*) FROM public.financial_transactions WHERE organization_id=v_org));
  IF EXISTS(SELECT 1 FROM public.cases c WHERE c.organization_id=v_org AND c.net_weight_kg IS NOT NULL AND c.gross_weight_kg IS NOT NULL AND c.gross_weight_kg<c.net_weight_kg) THEN v_issues:=v_issues||jsonb_build_array('پرونده‌ای با gross weight کمتر از net weight وجود دارد'); END IF;
  IF EXISTS(SELECT 1 FROM public.customs_declarations d WHERE d.organization_id=v_org AND NULLIF(trim(d.kottaj_number),'') IS NULL) THEN v_issues:=v_issues||jsonb_build_array('اظهار بدون کوتاژ وجود دارد'); END IF;
  IF EXISTS(SELECT 1 FROM public.cases c LEFT JOIN public.case_exit_operations e ON e.case_id=c.id WHERE c.organization_id=v_org AND c.status='completed' AND COALESCE(e.exit_status,'')<>'exited') THEN v_issues:=v_issues||jsonb_build_array('پرونده تکمیل‌شده بدون خروج نهایی وجود دارد'); END IF;
  RETURN jsonb_build_object('organization_id',v_org,'ok',jsonb_array_length(v_issues)=0,'issues',v_issues,'counts',v_counts,'generated_at',now());
END; $$;
REVOKE ALL ON FUNCTION public.get_customs_os_integrity_report() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_customs_os_integrity_report() TO authenticated;

DROP VIEW IF EXISTS public.case_operational_readiness;
CREATE VIEW public.case_operational_readiness WITH (security_invoker=true) AS
SELECT id AS case_id,organization_id,case_number,status,
  COALESCE((public.get_case_completion_readiness(id)->>'ready')::boolean,false) AS ready_for_completion,
  public.get_case_completion_readiness(id)->'issues' AS blocking_issues
FROM public.cases c;
REVOKE ALL ON TABLE public.case_operational_readiness FROM anon;
GRANT SELECT ON TABLE public.case_operational_readiness TO authenticated;

DROP FUNCTION IF EXISTS public.get_client_epl_credentials(uuid);
CREATE OR REPLACE FUNCTION public.get_client_epl_credentials(p_client_id uuid)
RETURNS TABLE(epl_username text,password_configured boolean)
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE v_org uuid:=public.user_org_id();
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF v_org IS NULL OR public.user_role() NOT IN ('owner','admin','broker') THEN RAISE EXCEPTION 'Insufficient access'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.clients WHERE id=p_client_id AND organization_id=v_org) THEN RAISE EXCEPTION 'Client not found or access denied'; END IF;
  RETURN QUERY SELECT c.epl_username,(c.vault_secret_id IS NOT NULL)
  FROM public.client_epl_credentials c WHERE c.organization_id=v_org AND c.client_id=p_client_id;
END; $$;
REVOKE ALL ON FUNCTION public.get_client_epl_credentials(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_client_epl_credentials(uuid) TO authenticated;
