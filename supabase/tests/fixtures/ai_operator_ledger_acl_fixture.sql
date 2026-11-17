CREATE SCHEMA IF NOT EXISTS auth;
DO $roles$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $roles$;
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb;
$$;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),
                 nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid;
$$;
CREATE TABLE public.profiles(id uuid PRIMARY KEY,organization_id uuid NOT NULL,is_active boolean NOT NULL DEFAULT true);
CREATE TABLE public.audit_logs(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,user_id uuid,table_name text NOT NULL,record_id uuid NOT NULL,action text NOT NULL);
CREATE TABLE public.ai_operator_commands(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid NOT NULL,user_id uuid NOT NULL,
 session_id text,natural_command text NOT NULL,page_context text,module text,action_code text,
 target jsonb NOT NULL DEFAULT '{}'::jsonb,plan jsonb NOT NULL DEFAULT '{}'::jsonb,confidence numeric,
 risk_level text NOT NULL,status text NOT NULL,confirmation_required boolean NOT NULL DEFAULT false,
 confirmation_at timestamptz,final_confirmation_phrase text,final_confirmation_at timestamptz,
 matched_record_id uuid,before_data jsonb,after_data jsonb,result jsonb,error_message text,
 executed_by uuid,executed_at timestamptz,updated_at timestamptz NOT NULL DEFAULT now(),created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ai_operator_commands ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_operator_commands_select ON public.ai_operator_commands FOR SELECT TO authenticated USING(user_id=auth.uid());
CREATE POLICY ai_operator_commands_insert ON public.ai_operator_commands FOR INSERT TO authenticated WITH CHECK(user_id=auth.uid());
CREATE POLICY ai_operator_commands_update ON public.ai_operator_commands FOR UPDATE TO authenticated USING(user_id=auth.uid()) WITH CHECK(user_id=auth.uid());
CREATE POLICY ai_operator_commands_delete ON public.ai_operator_commands FOR DELETE TO authenticated USING(user_id=auth.uid());
GRANT SELECT,INSERT,UPDATE,DELETE ON public.ai_operator_commands TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.ai_operator_commands TO service_role;
CREATE OR REPLACE FUNCTION public.record_audit_event() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 INSERT INTO public.audit_logs(user_id,table_name,record_id,action) VALUES(auth.uid(),TG_TABLE_NAME,NEW.id,TG_OP);
 RETURN NEW;
END;
$$;
CREATE TRIGGER tr_audit_ai_operator_commands AFTER INSERT OR UPDATE ON public.ai_operator_commands FOR EACH ROW EXECUTE FUNCTION public.record_audit_event();
CREATE OR REPLACE FUNCTION public.ai_operator_transition_command(uuid,text,timestamptz,timestamptz,jsonb,text,jsonb,jsonb,uuid,timestamptz)
RETURNS public.ai_operator_commands LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN RETURN NULL; END;
$$;
GRANT EXECUTE ON FUNCTION public.ai_operator_transition_command(uuid,text,timestamptz,timestamptz,jsonb,text,jsonb,jsonb,uuid,timestamptz) TO authenticated;
INSERT INTO public.profiles(id,organization_id,is_active) VALUES('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
