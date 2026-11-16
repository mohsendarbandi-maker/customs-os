-- End-to-end SQL contract tests for the atomic customs workflow and exit release.
-- Run with psql -v ON_ERROR_STOP=1 after the fixture and migration.

CREATE TRIGGER trg_log_customs_declaration_workflow_event
AFTER INSERT OR UPDATE ON public.customs_declaration_workflow
FOR EACH ROW EXECUTE FUNCTION public.log_customs_declaration_workflow_event();

SET request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
SET request.jwt.claim.org_id = '00000000-0000-0000-0000-000000000001';
SET request.jwt.claim.role = 'broker';
SET ROLE authenticated;

DO $test$
DECLARE
  v_base jsonb;
  v_result jsonb;
  v_stage text;
  v_inspection_paid text;
  v_events integer;
BEGIN
  SELECT expertise_state INTO v_base
  FROM public.customs_declaration_workflow
  WHERE id = '00000000-0000-0000-0000-000000000030';

  v_result := public.patch_customs_declaration_workflow_activity(
    '00000000-0000-0000-0000-000000000030',
    'expertise',
    '{"standard":{"expert_review":"approved"}}'::jsonb,
    v_base,
    'evaluation'
  );
  IF v_result #>> '{expertise_state,standard,expert_review}' <> 'approved' THEN
    RAISE EXCEPTION 'First expertise patch was not saved';
  END IF;

  -- A second operator uses the original snapshot but changes a different leaf.
  -- It must merge without overwriting the first operator's expert_review.
  v_result := public.patch_customs_declaration_workflow_activity(
    '00000000-0000-0000-0000-000000000030',
    'expertise',
    '{"standard":{"inspection_paid":true}}'::jsonb,
    v_base,
    'evaluation'
  );
  IF v_result #>> '{expertise_state,standard,expert_review}' <> 'approved'
     OR v_result #>> '{expertise_state,standard,inspection_paid}' <> 'true' THEN
    RAISE EXCEPTION 'Disjoint parallel edits did not merge';
  END IF;
  IF v_result ->> 'current_stage' <> 'expertise' THEN
    RAISE EXCEPTION 'A stale parallel request overwrote the newer stage pointer';
  END IF;

  -- A stale edit to the same leaf must fail with serialization SQLSTATE 40001.
  BEGIN
    PERFORM public.patch_customs_declaration_workflow_activity(
      '00000000-0000-0000-0000-000000000030',
      'expertise',
      '{"standard":{"expert_review":"rejected"}}'::jsonb,
      v_base,
      'evaluation'
    );
    RAISE EXCEPTION 'Expected same-leaf conflict was not raised';
  EXCEPTION WHEN SQLSTATE '40001' THEN
    NULL;
  END;

  SELECT count(*) INTO v_events
  FROM public.customs_declaration_workflow_events
  WHERE workflow_id = '00000000-0000-0000-0000-000000000030';
  IF v_events <> 3 THEN
    RAISE EXCEPTION 'Expected created + two successful patches events, got %', v_events;
  END IF;

  -- Rollback of the most recent patch restores only its changed leaf.
  PERFORM public.rollback_customs_declaration_workflow(
    '00000000-0000-0000-0000-000000000030'
  );
  SELECT expertise_state -> 'standard' ->> 'expert_review',
         expertise_state -> 'standard' ->> 'inspection_paid'
    INTO v_stage, v_inspection_paid
  FROM public.customs_declaration_workflow
  WHERE id = '00000000-0000-0000-0000-000000000030';
  IF v_stage <> 'approved' OR v_inspection_paid <> 'false' THEN
    RAISE EXCEPTION 'Rollback overwrote an unrelated parallel leaf';
  END IF;

  -- A rollback event blocks immediate repeated rollback.
  BEGIN
    PERFORM public.rollback_customs_declaration_workflow(
      '00000000-0000-0000-0000-000000000030'
    );
    RAISE EXCEPTION 'Immediate repeated rollback should be rejected';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'Immediate repeated rollback should be rejected' THEN
      RAISE;
    END IF;
  END;

  -- An authenticated user from another organization must not reach the row.
  PERFORM set_config('request.jwt.claim.org_id','00000000-0000-0000-0000-000000000099',false);
  BEGIN
    PERFORM public.patch_customs_declaration_workflow_activity(
      '00000000-0000-0000-0000-000000000030',
      'expertise',
      '{"standard":{"inspection_paid":false}}'::jsonb,
      v_base,
      'evaluation'
    );
    RAISE EXCEPTION 'Cross-organization workflow edit unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'Cross-organization workflow edit unexpectedly succeeded' THEN
      RAISE;
    END IF;
    IF SQLERRM NOT LIKE '%not found or access denied%' THEN
      RAISE;
    END IF;
  END;
  PERFORM set_config('request.jwt.claim.org_id','00000000-0000-0000-0000-000000000001',false);
END;
$test$;

-- The incomplete workflow must not release the shipment to finance.
SET request.jwt.claim.role = 'warehouse';
DO $gate$
DECLARE
  v_result jsonb;
  v_finance_status text;
BEGIN
  v_result := public.complete_customs_declaration_exit(
    '00000000-0000-0000-0000-000000000020',
    NULL
  );
  IF COALESCE((v_result ->> 'ready')::boolean, true) THEN
    RAISE EXCEPTION 'Incomplete workflow was incorrectly marked ready';
  END IF;
  SELECT finance_status INTO v_finance_status
  FROM public.shipments
  WHERE id = '00000000-0000-0000-0000-000000000010';
  IF v_finance_status <> 'not_ready' THEN
    RAISE EXCEPTION 'An incomplete workflow changed shipment finance_status';
  END IF;
END;
$gate$;

-- A NULL customs regime must never pass the definitive-import exit endpoint.
RESET ROLE;
UPDATE public.customs_declarations
SET customs_regime = NULL
WHERE id = '00000000-0000-0000-0000-000000000020';
SET ROLE authenticated;
DO $unknown_regime$
BEGIN
  BEGIN
    PERFORM public.complete_customs_declaration_exit(
      '00000000-0000-0000-0000-000000000020',
      NULL
    );
    RAISE EXCEPTION 'NULL customs regime unexpectedly passed the exit gate';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'NULL customs regime unexpectedly passed the exit gate' THEN
      RAISE;
    END IF;
    IF SQLERRM NOT LIKE '%only for definitive import%' THEN
      RAISE;
    END IF;
  END;
END;
$unknown_regime$;

-- A NULL route is a readiness blocker rather than silently making assessment optional.
RESET ROLE;
UPDATE public.customs_declarations
SET customs_regime = 'import_definitive', customs_path = NULL
WHERE id = '00000000-0000-0000-0000-000000000020';
SET ROLE authenticated;
DO $unknown_path$
DECLARE
  v_result jsonb;
BEGIN
  v_result := public.complete_customs_declaration_exit(
    '00000000-0000-0000-0000-000000000020',
    NULL
  );
  IF COALESCE((v_result ->> 'ready')::boolean, true) THEN
    RAISE EXCEPTION 'NULL customs path unexpectedly passed the exit gate';
  END IF;
  IF NOT ('مسیر گمرکی اظهارنامه مشخص نیست؛ مسیر سبز، زرد یا قرمز را تعیین کنید.' = ANY(
    ARRAY(SELECT jsonb_array_elements_text(v_result -> 'issues'))
  )) THEN
    RAISE EXCEPTION 'NULL route blocker was not returned to the caller';
  END IF;
END;
$unknown_path$;

RESET ROLE;
UPDATE public.customs_declarations
SET customs_path = 'green'
WHERE id = '00000000-0000-0000-0000-000000000020';

-- Populate the authoritative workflow state and mandatory exit checklist as
-- the fixture owner, then re-enter through the authenticated warehouse role.
UPDATE public.customs_declaration_workflow
SET
  evaluation_state = '{"status":"not_required","expert_requested":false,"evaluator_number":""}',
  expertise_state = '{"appointment_status":"not_required","road_authority_status":"not_required","plant_quarantine_status":"not_required","standard":{"expert_review":"not_required"}}',
  cashier_state = '{"method":"cash","cash_paid_irr":"0","guarantee_duties":false,"guarantee_vat":false,"guarantee_reference":""}',
  loading_permit_state = '{"clause2_request_status":"not_required","tax_permission_status":"not_required","central_bank_status":"not_required","sata_code":"","clearance_90_percent_requested":false,"comment":""}',
  exit_state = '{"loading_permission_status":"approved","financial_registration_status":"registered","weighbridge_required":false,"weighbridge_paid":false,"loading_completed_at":"1405/01/02"}',
  port_charges_state = '{"insurance_policy_no":"POLICY-TEST","insurance_issue_date":"1404/12/29","insurance_followup_status":"pending","warehouse_receipt_date":"1405/01/01","initial_invoice_status":"received","transport_power_of_attorney_status":"received","loading_form_received_at":"1405/01/01","loading_started_at":"","supplemental_invoice_status":"not_required","last_truck_loaded_at":""}',
  updated_at = now()
WHERE id = '00000000-0000-0000-0000-000000000030';

UPDATE public.declaration_exit_checklist_items
SET completed = true
WHERE organization_id = '00000000-0000-0000-0000-000000000001'
  AND declaration_id = '00000000-0000-0000-0000-000000000020';

-- Verify SQL Jalali parsing and leap-year boundaries before attempting release.
DO $dates$
BEGIN
  IF public.customs_workflow_jalali_date_key('۱۴۰۵/۰۱/۰۱') <> 14050101 THEN
    RAISE EXCEPTION 'Persian digit date normalization failed';
  END IF;
  IF public.customs_workflow_jalali_date_key('1403/12/30') IS NULL THEN
    RAISE EXCEPTION 'Leap-year last day was rejected';
  END IF;
  IF public.customs_workflow_jalali_date_key('1404/12/30') IS NOT NULL THEN
    RAISE EXCEPTION 'Invalid non-leap-year last day was accepted';
  END IF;
END;
$dates$;

SET request.jwt.claim.role = 'warehouse';
SET ROLE authenticated;

DO $release$
DECLARE
  v_result jsonb;
  v_finance_status text;
  v_workflow_sata text;
  v_shipment_sata text;
  v_stage integer;
BEGIN
  v_result := public.complete_customs_declaration_exit(
    '00000000-0000-0000-0000-000000000020',
    'SAT-TEST-123'
  );
  IF NOT COALESCE((v_result ->> 'ready')::boolean, false) THEN
    RAISE EXCEPTION 'Ready workflow did not pass final exit gate: %', v_result -> 'issues';
  END IF;

  SELECT finance_status INTO v_finance_status
  FROM public.shipments
  WHERE id = '00000000-0000-0000-0000-000000000010';
  SELECT loading_permit_state ->> 'sata_code' INTO v_workflow_sata
  FROM public.customs_declaration_workflow
  WHERE id = '00000000-0000-0000-0000-000000000030';
  SELECT sata_code INTO v_shipment_sata
  FROM public.shipment_customs_data
  WHERE shipment_id = '00000000-0000-0000-0000-000000000010';
  SELECT workflow_stage INTO v_stage
  FROM public.customs_declarations
  WHERE id = '00000000-0000-0000-0000-000000000020';

  IF v_finance_status <> 'ready' OR v_stage <> 6 THEN
    RAISE EXCEPTION 'Final exit did not atomically advance declaration and finance status';
  END IF;
  IF v_workflow_sata <> 'SAT-TEST-123' OR v_shipment_sata <> 'SAT-TEST-123' THEN
    RAISE EXCEPTION 'SATA canonical workflow value and shipment compatibility mirror diverged';
  END IF;
END;
$release$;

RESET ROLE;

SELECT 'customs workflow atomic PostgreSQL contract tests passed' AS result;
