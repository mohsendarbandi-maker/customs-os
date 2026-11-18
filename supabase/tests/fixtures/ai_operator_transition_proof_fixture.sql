-- Test-only AI Operator signed-completion fixture. Never use against Production.
DO $$
BEGIN
  CREATE ROLE anon NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;
DO $$
BEGIN
  CREATE ROLE authenticated NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;
DO $$
BEGIN
  CREATE ROLE service_role NOLOGIN BYPASSRLS;
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE SCHEMA IF NOT EXISTS vault;

CREATE TABLE IF NOT EXISTS auth.users (id uuid primary key);
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;

CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid primary key,
  organization_id uuid not null,
  is_active boolean not null default true
);
INSERT INTO public.profiles(id,organization_id,is_active) VALUES
 ('00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000001',true),
 ('00000000-0000-0000-0000-000000000102','00000000-0000-0000-0000-000000000002',true)
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS vault.decrypted_secrets (
  name text primary key,
  decrypted_secret text not null
);
INSERT INTO vault.decrypted_secrets(name, decrypted_secret)
VALUES ('ai_operator_transition_hmac_v1','local-test-only-ai-operator-hmac-secret-2026-never-production')
ON CONFLICT (name) DO UPDATE SET decrypted_secret = excluded.decrypted_secret;

CREATE TABLE IF NOT EXISTS public.ai_operator_commands (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  user_id uuid not null references public.profiles(id),
  session_id text,
  natural_command text not null,
  page_context text,
  module text,
  action_code text,
  target jsonb not null default '{}'::jsonb,
  plan jsonb not null default '{}'::jsonb,
  confidence numeric(4,3),
  risk_level text not null default 'safe',
  status text not null,
  confirmation_required boolean not null default false,
  confirmation_at timestamptz,
  final_confirmation_phrase text,
  final_confirmation_at timestamptz,
  before_data jsonb,
  after_data jsonb,
  result jsonb,
  error_message text,
  executed_by uuid references public.profiles(id),
  executed_at timestamptz,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

INSERT INTO public.ai_operator_commands(
 id, organization_id, user_id, natural_command, target, plan, risk_level, status
)
VALUES
 ('00000000-0000-0000-0000-000000000201','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000101','signed completion test','{}','{}','safe','executing'),
 ('00000000-0000-0000-0000-000000000202','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000102','cross-user proof test','{}','{}','safe','executing'),
 ('00000000-0000-0000-0000-000000000203','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000101','tamper proof test','{}','{}','safe','executing'),
 ('00000000-0000-0000-0000-000000000204','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000101','expired proof test','{}','{}','safe','executing'),
 ('00000000-0000-0000-0000-000000000205','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000101','failure attribution test','{}','{}','safe','executing'),
 ('00000000-0000-0000-0000-000000000206','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000101','signed failure test','{}','{}','safe','executing'),
 ('00000000-0000-0000-0000-000000000207','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000101','signed clarification test','{}','{}','safe','executing')
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.ai_operator_fail_command_with_proof(
  p_command_id uuid,p_proof_payload text,p_proof_signature text
)
RETURNS public.ai_operator_commands
LANGUAGE plpgsql SECURITY DEFINER
as $$
DECLARE v_row public.ai_operator_commands;
BEGIN
  UPDATE public.ai_operator_commands SET status='failed' WHERE id=p_command_id RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.ai_operator_begin_command_with_proof(
  p_command_id uuid,p_proof_payload text,p_proof_signature text
)
RETURNS public.ai_operator_commands
LANGUAGE plpgsql SECURITY DEFINER
as $$
DECLARE v_row public.ai_operator_commands;
BEGIN
  UPDATE public.ai_operator_commands SET status='executing' WHERE id=p_command_id RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.ai_operator_transition_command(
  p_command_id uuid,
  p_status text,
  p_confirmation_at timestamptz default null,
  p_final_confirmation_at timestamptz default null,
  p_result jsonb default null,
  p_error_message text default null,
  p_before_data jsonb default null,
  p_after_data jsonb default null,
  p_executed_by uuid default null,
  p_executed_at timestamptz default null
)
RETURNS public.ai_operator_commands
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, pg_temp
AS $$
DECLARE v_row public.ai_operator_commands;
BEGIN
  UPDATE public.ai_operator_commands
  SET status = p_status,
      confirmation_at = coalesce(p_confirmation_at, confirmation_at),
      final_confirmation_at = coalesce(p_final_confirmation_at, final_confirmation_at),
      result = coalesce(p_result, result),
      error_message = coalesce(p_error_message, error_message),
      before_data = coalesce(p_before_data, before_data),
      after_data = coalesce(p_after_data, after_data),
      executed_by = coalesce(p_executed_by, executed_by),
      executed_at = coalesce(p_executed_at, executed_at)
  WHERE id = p_command_id
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT ON public.ai_operator_commands TO authenticated;
GRANT EXECUTE ON FUNCTION public.ai_operator_transition_command(uuid,text,timestamptz,timestamptz,jsonb,text,jsonb,jsonb,uuid,timestamptz)
TO authenticated;
