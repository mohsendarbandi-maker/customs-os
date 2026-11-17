-- Make AI Operator command creation and final audit writes server-owned.
BEGIN;
REVOKE INSERT, UPDATE, DELETE ON public.ai_operator_commands FROM anon, authenticated;
DROP POLICY IF EXISTS ai_operator_commands_insert ON public.ai_operator_commands;
DROP POLICY IF EXISTS ai_operator_commands_update ON public.ai_operator_commands;
DROP POLICY IF EXISTS ai_operator_commands_delete ON public.ai_operator_commands;

REVOKE ALL ON FUNCTION public.ai_operator_transition_command(
 uuid,text,timestamptz,timestamptz,jsonb,text,jsonb,jsonb,uuid,timestamptz
) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.ai_operator_create_command_trusted(
 p_user_id uuid, p_command jsonb
) RETURNS public.ai_operator_commands
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
 v_profile public.profiles;
 v_row public.ai_operator_commands;
 v_risk text;
 v_status text;
 v_action text;
 v_phrase text;
BEGIN
 IF coalesce(auth.jwt() ->> 'role','') <> 'service_role' THEN
   RAISE EXCEPTION 'Trusted AI Operator server context required';
 END IF;
 IF p_user_id IS NULL OR jsonb_typeof(p_command) <> 'object' THEN
   RAISE EXCEPTION 'AI Operator command identity and payload are required';
 END IF;
 SELECT * INTO v_profile FROM public.profiles WHERE id=p_user_id;
 IF NOT FOUND OR v_profile.is_active IS DISTINCT FROM TRUE OR v_profile.organization_id IS NULL THEN
   RAISE EXCEPTION 'Active AI Operator profile not found';
 END IF;
 v_risk := p_command ->> 'risk_level';
 v_status := p_command ->> 'status';
 v_action := p_command ->> 'action_code';
 v_phrase := nullif(pg_catalog.btrim(p_command ->> 'final_confirmation_phrase'),'');
 IF nullif(pg_catalog.btrim(p_command ->> 'natural_command'),'') IS NULL
    OR nullif(pg_catalog.btrim(v_action),'') IS NULL
    OR v_risk NOT IN ('safe','requires_confirmation','destructive') THEN
   RAISE EXCEPTION 'Invalid AI Operator command payload';
 END IF;
 IF NOT (
   (v_status='proposed' AND v_risk='safe' AND v_action<>'clarification')
   OR (v_status='awaiting_confirmation' AND v_risk IN ('requires_confirmation','destructive'))
   OR (v_status='clarification_needed' AND v_risk='safe' AND v_action='clarification')
 ) THEN RAISE EXCEPTION 'Invalid initial AI Operator command state'; END IF;
 IF (v_risk='destructive') IS DISTINCT FROM (v_phrase IS NOT NULL) THEN
   RAISE EXCEPTION 'Destructive commands require a final confirmation phrase';
 END IF;
 PERFORM pg_catalog.set_config('request.jwt.claim.sub',p_user_id::text,true);
 INSERT INTO public.ai_operator_commands (
   organization_id,user_id,session_id,natural_command,page_context,module,action_code,
   target,plan,confidence,risk_level,status,confirmation_required,final_confirmation_phrase
 ) VALUES (
   v_profile.organization_id,p_user_id,nullif(p_command->>'session_id',''),
   p_command->>'natural_command',nullif(p_command->>'page_context',''),
   p_command->>'module',v_action,coalesce(p_command->'target','{}'::jsonb),
   coalesce(p_command->'plan','{}'::jsonb),nullif(p_command->>'confidence','')::numeric,
   v_risk,v_status,coalesce((p_command->>'confirmation_required')::boolean,false),v_phrase
 ) RETURNING * INTO v_row;
 RETURN v_row;
END;
$function$;

CREATE OR REPLACE FUNCTION public.ai_operator_transition_command_trusted(
 p_command_id uuid,p_user_id uuid,p_status text,
 p_confirmation_at timestamptz DEFAULT NULL,
 p_final_confirmation_at timestamptz DEFAULT NULL,
 p_result jsonb DEFAULT NULL,p_error_message text DEFAULT NULL,
 p_before_data jsonb DEFAULT NULL,p_after_data jsonb DEFAULT NULL,
 p_executed_by uuid DEFAULT NULL,p_executed_at timestamptz DEFAULT NULL
) RETURNS public.ai_operator_commands
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
 v_old public.ai_operator_commands;
 v_new public.ai_operator_commands;
 v_allowed boolean := false;
BEGIN
 IF coalesce(auth.jwt() ->> 'role','') <> 'service_role' THEN
   RAISE EXCEPTION 'Trusted AI Operator server context required';
 END IF;
 IF p_user_id IS NULL OR p_command_id IS NULL THEN
   RAISE EXCEPTION 'AI Operator command identity is required';
 END IF;
 SELECT * INTO v_old FROM public.ai_operator_commands WHERE id=p_command_id FOR UPDATE;
 IF NOT FOUND OR v_old.user_id IS DISTINCT FROM p_user_id THEN
   RAISE EXCEPTION 'AI Operator command not found for verified user';
 END IF;
 IF v_old.status IN ('executed','failed','rejected','cancelled','clarification_needed') THEN
   RAISE EXCEPTION 'Terminal AI Operator command is immutable';
 END IF;
 IF p_executed_by IS NOT NULL AND p_executed_by IS DISTINCT FROM p_user_id THEN
   RAISE EXCEPTION 'AI Operator execution actor mismatch';
 END IF;
 v_allowed :=
   (v_old.status='proposed' AND p_status IN ('awaiting_confirmation','executing','clarification_needed','cancelled','rejected'))
   OR (v_old.status='awaiting_confirmation' AND p_status IN ('awaiting_confirmation','executing','clarification_needed','cancelled','rejected'))
   OR (v_old.status='executing' AND p_status IN ('executed','failed','clarification_needed'));
 IF NOT v_allowed THEN RAISE EXCEPTION 'Invalid AI Operator status transition'; END IF;
 IF p_status IN ('executed','failed')
    AND (p_executed_by IS DISTINCT FROM p_user_id OR p_executed_at IS NULL) THEN
   RAISE EXCEPTION 'Terminal execution audit requires a verified actor and timestamp';
 END IF;
 IF p_status='executed' AND p_result IS NULL THEN
   RAISE EXCEPTION 'Successful execution audit requires a result';
 END IF;
 IF p_status='failed' AND nullif(pg_catalog.btrim(p_error_message),'') IS NULL THEN
   RAISE EXCEPTION 'Failed execution audit requires an error message';
 END IF;
 PERFORM pg_catalog.set_config('request.jwt.claim.sub',p_user_id::text,true);
 UPDATE public.ai_operator_commands
 SET status=p_status,
     confirmation_at=coalesce(p_confirmation_at,confirmation_at),
     final_confirmation_at=coalesce(p_final_confirmation_at,final_confirmation_at),
     before_data=coalesce(p_before_data,before_data),
     after_data=coalesce(p_after_data,after_data),
     result=coalesce(p_result,result),
     error_message=coalesce(p_error_message,error_message),
     executed_by=coalesce(p_executed_by,executed_by),
     executed_at=coalesce(p_executed_at,executed_at),
     updated_at=pg_catalog.now()
 WHERE id=p_command_id RETURNING * INTO v_new;
 RETURN v_new;
END;
$function$;

REVOKE ALL ON FUNCTION public.ai_operator_create_command_trusted(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ai_operator_create_command_trusted(uuid,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.ai_operator_transition_command_trusted(
 uuid,uuid,text,timestamptz,timestamptz,jsonb,text,jsonb,jsonb,uuid,timestamptz
) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ai_operator_transition_command_trusted(
 uuid,uuid,text,timestamptz,timestamptz,jsonb,text,jsonb,jsonb,uuid,timestamptz
) TO service_role;
COMMIT;
