BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000101',true);

DO $$
DECLARE
  v_secret text := 'local-test-only-ai-operator-hmac-secret-2026-never-production';
  v_payload text;
  v_signature text;
  v_tampered text;
  v_row public.ai_operator_commands;
  v_expected uuid := '00000000-0000-0000-0000-000000000101';
  v_other uuid := '00000000-0000-0000-0000-000000000102';
BEGIN
  IF has_table_privilege('authenticated','public.ai_operator_commands','INSERT')
     OR has_table_privilege('anon','public.ai_operator_commands','INSERT') THEN
    RAISE EXCEPTION 'Direct command ledger INSERT must be denied to API roles';
  END IF;
  IF NOT has_table_privilege('authenticated','public.ai_operator_commands','SELECT') THEN
    RAISE EXCEPTION 'Authenticated users must retain their own history read access';
  END IF;

  BEGIN
    INSERT INTO public.ai_operator_commands(organization_id,user_id,natural_command,status)
    VALUES ('00000000-0000-0000-0000-000000000001',v_expected,'forged initial record','executed');
    RAISE EXCEPTION 'Expected direct command insert to be denied';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  -- The authenticated creation RPC derives owner and tenant from auth.uid()
  -- and does not accept a terminal state or forged execution fields.
  SELECT * INTO v_row
  FROM public.ai_operator_create_command(
    'session-test','safe read request','/control','control','control.report',
    '{}'::jsonb,'{"action_code":"control.report","module":"control","target":{},"params":{}}'::jsonb,
    0.99,'safe','proposed',NULL
  );
  IF v_row.user_id <> v_expected
     OR v_row.organization_id <> '00000000-0000-0000-0000-000000000001'
     OR v_row.status <> 'proposed'
     OR v_row.executed_by IS NOT NULL
     OR v_row.executed_at IS NOT NULL THEN
    RAISE EXCEPTION 'Authenticated creation RPC did not bind identity/tenant or set safe initial state';
  END IF;

  -- Direct transition to executing is no longer allowed even on a user's own row.
  BEGIN
    PERFORM public.ai_operator_transition_command(
      v_row.id,'executing',clock_timestamp(),NULL,NULL,NULL,NULL,NULL,NULL,NULL
    );
    RAISE EXCEPTION 'Expected direct executing transition to be rejected';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%Direct executing/executed transitions are forbidden%' THEN RAISE; END IF;
  END;

  -- A mathematically valid but wrong-risk proof cannot begin a different persisted plan.
  v_payload := jsonb_build_object(
    'version',1,'purpose','begin','command_id',v_row.id,
    'user_id',v_expected,'status','executing','risk_level','destructive',
    'issued_at',clock_timestamp(),'nonce','wrong-risk-begin',
    'confirmation_at',clock_timestamp(),'final_confirmation_at',clock_timestamp()
  )::text;
  v_signature := encode(extensions.hmac(convert_to(v_payload,'UTF8'),convert_to(v_secret,'UTF8'),'sha256'),'hex');
  BEGIN
    PERFORM public.ai_operator_begin_command_with_proof(v_row.id,v_payload,v_signature);
    RAISE EXCEPTION 'Expected a mismatched-risk begin proof to be rejected';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%risk does not match%' THEN RAISE; END IF;
  END;

  -- Only a valid Edge Function proof can move the safe command to executing.
  v_payload := jsonb_build_object(
    'version',1,'purpose','begin','command_id',v_row.id,
    'user_id',v_expected,'status','executing','risk_level','safe',
    'issued_at',clock_timestamp(),'nonce','safe-begin-001',
    'confirmation_at',clock_timestamp(),'final_confirmation_at',NULL
  )::text;
  v_signature := encode(extensions.hmac(convert_to(v_payload,'UTF8'),convert_to(v_secret,'UTF8'),'sha256'),'hex');
  SELECT * INTO v_row
  FROM public.ai_operator_begin_command_with_proof(v_row.id,v_payload,v_signature);
  IF v_row.status <> 'executing' THEN
    RAISE EXCEPTION 'Signed begin proof did not move proposed command to executing';
  END IF;

  BEGIN
    PERFORM public.ai_operator_create_command(
      NULL,'forged terminal row',NULL,'control','control.report',
      '{}'::jsonb,'{"action_code":"control.report"}'::jsonb,1,
      'safe','executed',NULL
    );
    RAISE EXCEPTION 'Expected terminal state creation to be rejected';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%initial command state is not permitted%' THEN RAISE; END IF;
  END;

  IF has_function_privilege('anon','public.ai_operator_fail_command_with_proof(uuid,text,text)','EXECUTE')
     OR has_function_privilege('anon','public.ai_operator_begin_command_with_proof(uuid,text,text)','EXECUTE')
     OR has_function_privilege('anon','public.ai_operator_assert_transition_signer(text,text)','EXECUTE')
     OR has_function_privilege('anon','public.ai_operator_complete_command_with_proof(uuid,text,text)','EXECUTE')
     OR has_function_privilege('anon','public.ai_operator_transition_command(uuid,text,timestamp with time zone,timestamp with time zone,jsonb,text,jsonb,jsonb,uuid,timestamp with time zone)','EXECUTE') THEN
    RAISE EXCEPTION 'Anonymous role must not execute AI Operator transition RPCs';
  END IF;
  IF has_function_privilege('authenticated','ai_operator_private.verify_ai_operator_transition_proof(text,text,uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'Authenticated users must not call the private proof verifier directly';
  END IF;

  -- A caller-supplied actor/timestamp and result cannot directly mark a command executed.
  BEGIN
    PERFORM public.ai_operator_transition_command(
      '00000000-0000-0000-0000-000000000201',
      'executed',
      NULL,NULL,'{"forged":true}'::jsonb,NULL,NULL,NULL,v_other,'2001-01-01T00:00:00Z'
    );
    RAISE EXCEPTION 'Expected direct executed transition to be rejected';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%Direct executing/terminal transitions are forbidden%' THEN
      RAISE;
    END IF;
  END;

  -- Direct failed/clarification states are also forbidden without a server proof.
  BEGIN
    PERFORM public.ai_operator_transition_command(
      '00000000-0000-0000-0000-000000000206','failed',NULL,NULL,'{"fake":true}'::jsonb,
      'forged failure',NULL,NULL,v_other,'2001-01-01T00:00:00Z'
    );
    RAISE EXCEPTION 'Expected direct failed transition to be rejected';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%Direct executing/terminal transitions are forbidden%' THEN RAISE; END IF;
  END;

  IF (SELECT status FROM public.ai_operator_commands WHERE id='00000000-0000-0000-0000-000000000201') <> 'executing' THEN
    RAISE EXCEPTION 'Rejected direct transition changed the command row';
  END IF;

  -- Prove the Edge Function and Vault keys match before any real business action.
  v_payload := jsonb_build_object(
    'version',1,'purpose','preflight','user_id',v_expected,
    'issued_at',clock_timestamp(),'nonce','preflight-nonce-001'
  )::text;
  v_signature := encode(extensions.hmac(convert_to(v_payload,'UTF8'),convert_to(v_secret,'UTF8'),'sha256'),'hex');
  IF public.ai_operator_assert_transition_signer(v_payload,v_signature) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Valid signer preflight proof was not accepted';
  END IF;

  -- A valid signed completion writes only the authenticated actor and signed result/snapshots.
  v_payload := jsonb_build_object(
    'version',1,'purpose','completion',
    'command_id','00000000-0000-0000-0000-000000000201',
    'user_id',v_expected,'status','executed',
    'issued_at',clock_timestamp(),'nonce','completion-nonce-001',
    'confirmation_at',clock_timestamp(),'final_confirmation_at',NULL,
    'before_data',jsonb_build_object('status','draft'),
    'after_data',jsonb_build_object('status','saved'),
    'result',jsonb_build_object('id','business-row-001','success',true),
    'executed_by',v_other
  )::text;
  v_signature := encode(extensions.hmac(convert_to(v_payload,'UTF8'),convert_to(v_secret,'UTF8'),'sha256'),'hex');
  SELECT * INTO v_row
  FROM public.ai_operator_complete_command_with_proof(
    '00000000-0000-0000-0000-000000000201',v_payload,v_signature
  );
  IF v_row.status <> 'executed'
     OR v_row.executed_by <> v_expected
     OR v_row.result->>'id' <> 'business-row-001'
     OR v_row.before_data->>'status' <> 'draft'
     OR v_row.after_data->>'status' <> 'saved' THEN
    RAISE EXCEPTION 'Signed completion did not persist the expected trusted audit record';
  END IF;

  -- A signature for one user cannot be replayed against another user's command.
  v_payload := jsonb_build_object(
    'version',1,'purpose','completion',
    'command_id','00000000-0000-0000-0000-000000000202',
    'user_id',v_other,'status','executed',
    'issued_at',clock_timestamp(),'nonce','other-user-nonce',
    'before_data',NULL,'after_data',NULL,'result',jsonb_build_object('success',true)
  )::text;
  v_signature := encode(extensions.hmac(convert_to(v_payload,'UTF8'),convert_to(v_secret,'UTF8'),'sha256'),'hex');
  BEGIN
    PERFORM public.ai_operator_complete_command_with_proof(
      '00000000-0000-0000-0000-000000000202',v_payload,v_signature
    );
    RAISE EXCEPTION 'Expected cross-user proof to be rejected';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%proof user does not match%' THEN RAISE; END IF;
  END;

  -- A changed payload cannot reuse a previously valid signature.
  v_payload := jsonb_build_object(
    'version',1,'purpose','completion',
    'command_id','00000000-0000-0000-0000-000000000203',
    'user_id',v_expected,'status','executed',
    'issued_at',clock_timestamp(),'nonce','tamper-nonce',
    'before_data',NULL,'after_data',NULL,'result',jsonb_build_object('claim','trusted')
  )::text;
  v_signature := encode(extensions.hmac(convert_to(v_payload,'UTF8'),convert_to(v_secret,'UTF8'),'sha256'),'hex');
  v_tampered := replace(v_payload,'trusted','forged');
  BEGIN
    PERFORM public.ai_operator_complete_command_with_proof(
      '00000000-0000-0000-0000-000000000203',v_tampered,v_signature
    );
    RAISE EXCEPTION 'Expected tampered signed payload to be rejected';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%proof signature is invalid%' THEN RAISE; END IF;
  END;

  -- Expired signatures are rejected even when their HMAC is mathematically correct.
  v_payload := jsonb_build_object(
    'version',1,'purpose','completion',
    'command_id','00000000-0000-0000-0000-000000000204',
    'user_id',v_expected,'status','executed',
    'issued_at',clock_timestamp() - interval '1 hour','nonce','expired-nonce',
    'before_data',NULL,'after_data',NULL,'result',jsonb_build_object('success',true)
  )::text;
  v_signature := encode(extensions.hmac(convert_to(v_payload,'UTF8'),convert_to(v_secret,'UTF8'),'sha256'),'hex');
  BEGIN
    PERFORM public.ai_operator_complete_command_with_proof(
      '00000000-0000-0000-0000-000000000204',v_payload,v_signature
    );
    RAISE EXCEPTION 'Expected expired proof to be rejected';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%proof is expired%' THEN RAISE; END IF;
  END;

  -- Unsigned direct status changes cannot impersonate server-side failures.
  BEGIN
    PERFORM public.ai_operator_transition_command(
      '00000000-0000-0000-0000-000000000205',
      'failed',NULL,NULL,'{"error":"forged"}'::jsonb,'forged failure',NULL,NULL,
      v_other,'2001-01-01T00:00:00Z'
    );
    RAISE EXCEPTION 'Expected unsigned failed transition to be rejected';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%Direct executing/terminal transitions are forbidden%' THEN RAISE; END IF;
  END;
  -- Valid signed failure derives actor and timestamp and cannot accept caller spoofing.
  v_payload := jsonb_build_object(
    'version',1,'purpose','terminal',
    'command_id','00000000-0000-0000-0000-000000000206',
    'user_id',v_expected,'status','failed',
    'issued_at',clock_timestamp(),'nonce','signed-failure-001',
    'error_message','business action failed',
    'result',jsonb_build_object('error','expected test failure'),
    'executed_by',v_other
  )::text;
  v_signature := encode(extensions.hmac(convert_to(v_payload,'UTF8'),convert_to(v_secret,'UTF8'),'sha256'),'hex');
  SELECT * INTO v_row
  FROM public.ai_operator_fail_command_with_proof(
    '00000000-0000-0000-0000-000000000206',v_payload,v_signature
  );
  IF v_row.status <> 'failed'
     OR v_row.executed_by <> v_expected
     OR v_row.error_message <> 'business action failed'
     OR v_row.executed_at < clock_timestamp() - interval '1 minute' THEN
    RAISE EXCEPTION 'Signed failure did not derive trusted audit attribution';
  END IF;

  -- Clarification also needs a signed terminal state, but is not marked as execution.
  v_payload := jsonb_build_object(
    'version',1,'purpose','terminal',
    'command_id','00000000-0000-0000-0000-000000000207',
    'user_id',v_expected,'status','clarification_needed',
    'issued_at',clock_timestamp(),'nonce','signed-clarification-001',
    'error_message','Need more information',
    'result',jsonb_build_object('clarification','Need more information')
  )::text;
  v_signature := encode(extensions.hmac(convert_to(v_payload,'UTF8'),convert_to(v_secret,'UTF8'),'sha256'),'hex');
  SELECT * INTO v_row
  FROM public.ai_operator_fail_command_with_proof(
    '00000000-0000-0000-0000-000000000207',v_payload,v_signature
  );
  IF v_row.status <> 'clarification_needed'
     OR v_row.executed_by IS NOT NULL
     OR v_row.executed_at IS NOT NULL THEN
    RAISE EXCEPTION 'Signed clarification was incorrectly recorded as execution';
  END IF;
END;
$;

ROLLBACK;
