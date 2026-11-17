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
  IF has_function_privilege('anon','public.ai_operator_assert_transition_signer(text,text)','EXECUTE')
     OR has_function_privilege('anon','public.ai_operator_complete_command_with_proof(uuid,text,text)','EXECUTE')
     OR has_function_privilege('anon','public.ai_operator_transition_command(uuid,text,timestamp with time zone,timestamp with time zone,jsonb,text,jsonb,jsonb,uuid,timestamp with time zone)','EXECUTE') THEN
    RAISE EXCEPTION 'Anonymous role must not execute AI Operator transition RPCs';
  END IF;
  IF has_function_privilege('authenticated','private.verify_ai_operator_transition_proof(text,text,uuid)','EXECUTE') THEN
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
    IF SQLERRM NOT LIKE '%Direct executed transitions are forbidden%' THEN
      RAISE;
    END IF;
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

  -- Failed-command actor and timestamp are assigned by Postgres, never caller input.
  PERFORM public.ai_operator_transition_command(
    '00000000-0000-0000-0000-000000000205',
    'failed',NULL,NULL,'{"error":"test"}'::jsonb,'business failure',NULL,NULL,
    v_other,'2001-01-01T00:00:00Z'
  );
  SELECT * INTO v_row FROM public.ai_operator_commands
  WHERE id='00000000-0000-0000-0000-000000000205';
  IF v_row.status <> 'failed'
     OR v_row.executed_by <> v_expected
     OR v_row.executed_at < clock_timestamp() - interval '1 minute' THEN
    RAISE EXCEPTION 'Failed command actor/timestamp was not server-derived';
  END IF;
END;
$$;

ROLLBACK;
