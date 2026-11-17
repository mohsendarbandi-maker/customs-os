DO $privileges$
BEGIN
 IF has_table_privilege('authenticated','public.ai_operator_commands','INSERT') THEN RAISE EXCEPTION 'authenticated can still insert directly'; END IF;
 IF has_table_privilege('authenticated','public.ai_operator_commands','UPDATE') THEN RAISE EXCEPTION 'authenticated can still update directly'; END IF;
 IF NOT has_table_privilege('authenticated','public.ai_operator_commands','SELECT') THEN RAISE EXCEPTION 'authorized history read access lost'; END IF;
 IF has_function_privilege('authenticated','public.ai_operator_create_command_trusted(uuid,jsonb)','EXECUTE') OR has_function_privilege('anon','public.ai_operator_create_command_trusted(uuid,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'client can invoke trusted create'; END IF;
 IF has_function_privilege('authenticated','public.ai_operator_transition_command_trusted(uuid,uuid,text,timestamp with time zone,timestamp with time zone,jsonb,text,jsonb,jsonb,uuid,timestamp with time zone)','EXECUTE') OR has_function_privilege('anon','public.ai_operator_transition_command_trusted(uuid,uuid,text,timestamp with time zone,timestamp with time zone,jsonb,text,jsonb,jsonb,uuid,timestamp with time zone)','EXECUTE') THEN RAISE EXCEPTION 'client can invoke trusted transition'; END IF;
 IF NOT has_function_privilege('service_role','public.ai_operator_create_command_trusted(uuid,jsonb)','EXECUTE') OR NOT has_function_privilege('service_role','public.ai_operator_transition_command_trusted(uuid,uuid,text,timestamp with time zone,timestamp with time zone,jsonb,text,jsonb,jsonb,uuid,timestamp with time zone)','EXECUTE') THEN RAISE EXCEPTION 'service role lost trusted ledger access'; END IF;
 IF has_function_privilege('authenticated','public.ai_operator_transition_command(uuid,text,timestamp with time zone,timestamp with time zone,jsonb,text,jsonb,jsonb,uuid,timestamp with time zone)','EXECUTE') THEN RAISE EXCEPTION 'legacy client transition remains executable'; END IF;
END $privileges$;

SET ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"11111111-1111-4111-8111-111111111111"}',false);
DO $client_denials$
BEGIN
 BEGIN
  INSERT INTO public.ai_operator_commands(organization_id,user_id,natural_command,action_code,risk_level,status)
  VALUES('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','fake','cases.read','safe','executed');
  RAISE EXCEPTION 'direct insert unexpectedly succeeded';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  PERFORM public.ai_operator_create_command_trusted('11111111-1111-4111-8111-111111111111','{"natural_command":"fake","action_code":"cases.read","risk_level":"safe","status":"proposed"}'::jsonb);
  RAISE EXCEPTION 'trusted create unexpectedly succeeded';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  PERFORM public.ai_operator_transition_command(NULL,'executed',NULL,NULL,'{"fake":true}'::jsonb,NULL,NULL,NULL,'11111111-1111-4111-8111-111111111111',now());
  RAISE EXCEPTION 'legacy transition unexpectedly succeeded';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $client_denials$;
RESET ROLE;

SET ROLE service_role;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',false);
DO $trusted_flow$
DECLARE
 v_user uuid:='11111111-1111-4111-8111-111111111111';
 v_row public.ai_operator_commands;
 v_actor uuid;
 v_rejected boolean:=false;
BEGIN
 v_row:=public.ai_operator_create_command_trusted(v_user,jsonb_build_object(
  'natural_command','Read case status','page_context','/cases','module','cases','action_code','cases.read',
  'target','{}'::jsonb,'plan','{}'::jsonb,'confidence',0.99,'risk_level','safe','status','proposed','confirmation_required',false));
 IF v_row.user_id IS DISTINCT FROM v_user OR v_row.organization_id IS DISTINCT FROM 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid OR v_row.status<>'proposed' THEN RAISE EXCEPTION 'trusted create derivation failed'; END IF;
 SELECT user_id INTO v_actor FROM public.audit_logs WHERE table_name='ai_operator_commands' AND record_id=v_row.id AND action='INSERT';
 IF v_actor IS DISTINCT FROM v_user THEN RAISE EXCEPTION 'insert audit actor mismatch'; END IF;
 v_row:=public.ai_operator_transition_command_trusted(v_row.id,v_user,'executing');
 IF v_row.status<>'executing' THEN RAISE EXCEPTION 'executing transition failed'; END IF;
 v_row:=public.ai_operator_transition_command_trusted(v_row.id,v_user,'executed',NULL,NULL,'{"case_id":"sample"}'::jsonb,NULL,'{"before":1}'::jsonb,'{"after":2}'::jsonb,v_user,now());
 IF v_row.status<>'executed' OR v_row.executed_by IS DISTINCT FROM v_user OR v_row.executed_at IS NULL OR v_row.result IS NULL THEN RAISE EXCEPTION 'terminal evidence missing'; END IF;
 SELECT user_id INTO v_actor FROM public.audit_logs WHERE table_name='ai_operator_commands' AND record_id=v_row.id AND action='UPDATE' ORDER BY id DESC LIMIT 1;
 IF v_actor IS DISTINCT FROM v_user THEN RAISE EXCEPTION 'update audit actor mismatch'; END IF;
 BEGIN
  PERFORM public.ai_operator_transition_command_trusted(v_row.id,v_user,'failed',NULL,NULL,'{"fake":true}'::jsonb,'late change',NULL,NULL,v_user,now());
 EXCEPTION WHEN raise_exception THEN v_rejected:=true; END;
 IF NOT v_rejected THEN RAISE EXCEPTION 'executed command immutability failed'; END IF;
END $trusted_flow$;
RESET ROLE;
