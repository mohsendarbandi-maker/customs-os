-- Completion gate invariant: Gross weight must be present and cannot be below net weight.
CREATE OR REPLACE FUNCTION public.get_case_completion_readiness(p_case_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  v_org_id uuid := public.user_org_id();
  v_case record;
  v_pending_permits integer;
  v_decl boolean;
  v_valuation boolean;
  v_exit text;
  v_issues jsonb := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT id,organization_id,status,warehouse_receipt_no,release_status,net_weight_kg,gross_weight_kg INTO v_case
  FROM public.cases WHERE id=p_case_id AND organization_id=v_org_id;
  IF v_case.id IS NULL THEN RAISE EXCEPTION 'Case not found or access denied'; END IF;

  v_decl := EXISTS(
    SELECT 1 FROM public.customs_declarations d
    WHERE d.case_id=p_case_id AND d.organization_id=v_org_id
      AND NULLIF(trim(d.kottaj_number),'') IS NOT NULL
  );
  v_valuation := COALESCE((SELECT c.valuation_status='calculated' FROM public.cases c WHERE c.id=p_case_id AND c.organization_id=v_org_id),false);
  v_pending_permits := (SELECT count(*)::integer FROM public.permits p WHERE p.case_id=p_case_id AND p.organization_id=v_org_id AND p.status='pending');
  v_exit := (SELECT e.exit_status FROM public.case_exit_operations e WHERE e.case_id=p_case_id AND e.organization_id=v_org_id LIMIT 1);

  IF NOT v_decl THEN v_issues := v_issues || jsonb_build_array('اظهار/کوتاژ ثبت نشده'); END IF;
  IF v_case.warehouse_receipt_no IS NULL THEN v_issues := v_issues || jsonb_build_array('قبض انبار ثبت نشده'); END IF;
  IF COALESCE(v_case.release_status,'pending') <> 'released' THEN v_issues := v_issues || jsonb_build_array('ترخیصیه/تحویل محموله هنوز Released نشده است'); END IF;
  IF v_case.net_weight_kg IS NULL OR v_case.gross_weight_kg IS NULL THEN v_issues := v_issues || jsonb_build_array('وزن خالص و ناخالص ناقص است'); END IF;
  IF v_case.net_weight_kg IS NOT NULL AND v_case.gross_weight_kg IS NOT NULL AND v_case.gross_weight_kg < v_case.net_weight_kg THEN v_issues := v_issues || jsonb_build_array('وزن ناخالص نمی‌تواند کمتر از وزن خالص باشد'); END IF;
  IF NOT v_valuation THEN v_issues := v_issues || jsonb_build_array('ارزش‌گذاری محاسبه نشده'); END IF;
  IF v_pending_permits>0 THEN v_issues := v_issues || jsonb_build_array(format('%s مجوز در انتظار تعیین تکلیف است',v_pending_permits)); END IF;
  IF COALESCE(v_exit,'pending') <> 'exited' THEN v_issues := v_issues || jsonb_build_array('خروج نهایی کالا ثبت نشده'); END IF;

  RETURN jsonb_build_object(
    'case_id',p_case_id,
    'status',v_case.status,
    'ready',jsonb_array_length(v_issues)=0,
    'issues',v_issues,
    'declaration_ready',v_decl,
    'valuation_ready',v_valuation,
    'pending_permits',v_pending_permits,
    'release_ready',COALESCE(v_case.release_status,'pending')='released',
    'exit_status',COALESCE(v_exit,'pending')
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_case_completion_readiness(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_case_completion_readiness(uuid) TO authenticated;
