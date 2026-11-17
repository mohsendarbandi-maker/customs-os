-- Signed, server-authenticated completion for AI Operator commands.
-- Rollout prerequisite: store the same random 32+ character secret in:
--   1) Supabase Edge Function secret AI_OPERATOR_TRANSITION_HMAC_SECRET
--   2) Supabase Vault secret named ai_operator_transition_hmac_v1
-- Never commit either secret. The Edge Function verifies parity before executing a business action.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.verify_ai_operator_transition_proof(
  p_proof_payload text,
  p_proof_signature text,
  p_expected_user_id uuid
)
returns jsonb
language plpgsql
set search_path = pg_catalog, extensions, pg_temp
as $$
declare
  v_secret text;
  v_payload jsonb;
  v_expected bytea;
  v_provided bytea;
  v_issued_at timestamptz;
  v_mismatch integer := 0;
  v_index integer;
begin
  if p_expected_user_id is null then
    raise exception 'Authenticated AI Operator user is required';
  end if;
  if p_proof_payload is null or length(p_proof_payload) > 65536 then
    raise exception 'AI Operator proof payload is missing or too large';
  end if;
  if p_proof_signature is null or p_proof_signature !~ '^[0-9a-f]{64}$' then
    raise exception 'AI Operator proof signature format is invalid';
  end if;

  select decrypted_secret
    into v_secret
  from vault.decrypted_secrets
  where name = 'ai_operator_transition_hmac_v1'
  limit 1;

  if v_secret is null or length(v_secret) < 32 then
    raise exception 'AI Operator transition proof secret is not configured in Supabase Vault';
  end if;

  v_expected := extensions.hmac(
    convert_to(p_proof_payload, 'UTF8'),
    convert_to(v_secret, 'UTF8'),
    'sha256'
  );
  v_provided := decode(p_proof_signature, 'hex');

  -- Compare all 32 bytes rather than exiting on the first mismatched byte.
  for v_index in 0..31 loop
    v_mismatch := v_mismatch | (get_byte(v_expected, v_index) # get_byte(v_provided, v_index));
  end loop;
  if v_mismatch <> 0 then
    raise exception 'AI Operator proof signature is invalid';
  end if;

  begin
    v_payload := p_proof_payload::jsonb;
  exception when others then
    raise exception 'AI Operator proof payload is not valid JSON';
  end;

  if v_payload ->> 'version' <> '1' then
    raise exception 'AI Operator proof version is not supported';
  end if;
  if v_payload ->> 'user_id' <> p_expected_user_id::text then
    raise exception 'AI Operator proof user does not match the authenticated user';
  end if;
  if nullif(v_payload ->> 'nonce', '') is null then
    raise exception 'AI Operator proof nonce is required';
  end if;

  begin
    v_issued_at := (v_payload ->> 'issued_at')::timestamptz;
  exception when others then
    raise exception 'AI Operator proof issue time is invalid';
  end;
  if v_issued_at > clock_timestamp() + interval '30 seconds'
     or v_issued_at < clock_timestamp() - interval '5 minutes' then
    raise exception 'AI Operator proof is expired or not yet valid';
  end if;

  return v_payload;
end;
$$;

revoke all on function private.verify_ai_operator_transition_proof(text, text, uuid)
  from public, anon, authenticated;

create or replace function public.ai_operator_assert_transition_signer(
  p_proof_payload text,
  p_proof_signature text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, private, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_proof jsonb;
begin
  if v_uid is null then
    raise exception 'کاربر وارد سامانه نشده است';
  end if;

  v_proof := private.verify_ai_operator_transition_proof(
    p_proof_payload, p_proof_signature, v_uid
  );

  if v_proof ->> 'purpose' <> 'preflight' then
    raise exception 'AI Operator signer preflight proof purpose is invalid';
  end if;

  return true;
end;
$$;

create or replace function public.ai_operator_complete_command_with_proof(
  p_command_id uuid,
  p_proof_payload text,
  p_proof_signature text
)
returns public.ai_operator_commands
language plpgsql
security definer
set search_path = pg_catalog, public, private, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_proof jsonb;
  v_old public.ai_operator_commands;
  v_new public.ai_operator_commands;
  v_issued_at timestamptz;
begin
  if v_uid is null then
    raise exception 'کاربر وارد سامانه نشده است';
  end if;

  v_proof := private.verify_ai_operator_transition_proof(
    p_proof_payload, p_proof_signature, v_uid
  );

  if v_proof ->> 'purpose' <> 'completion'
     or v_proof ->> 'status' <> 'executed'
     or v_proof ->> 'command_id' <> p_command_id::text then
    raise exception 'AI Operator signed completion proof does not match this command';
  end if;

  v_issued_at := (v_proof ->> 'issued_at')::timestamptz;

  select *
    into v_old
  from public.ai_operator_commands
  where id = p_command_id
  for update;

  if not found or v_old.user_id <> v_uid then
    raise exception 'دستور پیدا نشد یا دسترسی ندارید';
  end if;
  if v_old.status <> 'executing' then
    raise exception 'Only an executing AI Operator command can be completed';
  end if;

  update public.ai_operator_commands
  set status = 'executed',
      confirmation_at = coalesce((v_proof ->> 'confirmation_at')::timestamptz, confirmation_at),
      final_confirmation_at = coalesce((v_proof ->> 'final_confirmation_at')::timestamptz, final_confirmation_at),
      before_data = v_proof -> 'before_data',
      after_data = v_proof -> 'after_data',
      result = v_proof -> 'result',
      error_message = null,
      executed_by = v_uid,
      executed_at = v_issued_at,
      updated_at = clock_timestamp()
  where id = p_command_id
  returning * into v_new;

  return v_new;
end;
$$;

create or replace function public.ai_operator_transition_command(
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
returns public.ai_operator_commands
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_old public.ai_operator_commands;
  v_new public.ai_operator_commands;
  v_uid uuid := auth.uid();
  v_allowed boolean := false;
begin
  if v_uid is null then
    raise exception 'کاربر وارد سامانه نشده است';
  end if;
  if p_status = 'executed' then
    raise exception 'Direct executed transitions are forbidden; use the signed AI Operator completion proof';
  end if;

  select *
    into v_old
  from public.ai_operator_commands
  where id = p_command_id
  for update;

  if not found or v_old.user_id <> v_uid then
    raise exception 'دستور پیدا نشد یا دسترسی ندارید';
  end if;
  if v_old.status = 'executed' then
    raise exception 'دستور اجراشده قابل تغییر نیست';
  end if;

  v_allowed :=
    (v_old.status = 'proposed' and p_status in ('awaiting_confirmation','executing','clarification_needed','cancelled','rejected')) or
    (v_old.status = 'awaiting_confirmation' and p_status in ('awaiting_confirmation','executing','clarification_needed','cancelled','rejected')) or
    (v_old.status = 'executing' and p_status in ('failed','clarification_needed'));

  if not v_allowed then
    raise exception 'انتقال وضعیت AI Operator مجاز نیست';
  end if;

  update public.ai_operator_commands
  set status = p_status,
      confirmation_at = coalesce(p_confirmation_at, confirmation_at),
      final_confirmation_at = coalesce(p_final_confirmation_at, final_confirmation_at),
      before_data = coalesce(p_before_data, before_data),
      after_data = coalesce(p_after_data, after_data),
      result = coalesce(p_result, result),
      error_message = coalesce(p_error_message, error_message),
      -- Actor and completion timestamp are database-owned for failed commands.
      executed_by = case when p_status = 'failed' then v_uid else executed_by end,
      executed_at = case when p_status = 'failed' then clock_timestamp() else executed_at end,
      updated_at = clock_timestamp()
  where id = p_command_id
  returning * into v_new;

  return v_new;
end;
$$;

revoke all on function public.ai_operator_assert_transition_signer(text, text)
  from public, anon, authenticated;
grant execute on function public.ai_operator_assert_transition_signer(text, text)
  to authenticated;

revoke all on function public.ai_operator_complete_command_with_proof(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.ai_operator_complete_command_with_proof(uuid, text, text)
  to authenticated;

revoke all on function public.ai_operator_transition_command(uuid,text,timestamptz,timestamptz,jsonb,text,jsonb,jsonb,uuid,timestamptz)
  from public, anon, authenticated;
grant execute on function public.ai_operator_transition_command(uuid,text,timestamptz,timestamptz,jsonb,text,jsonb,jsonb,uuid,timestamptz)
  to authenticated;

comment on function public.ai_operator_complete_command_with_proof(uuid, text, text) is
  'Completes an AI Operator command only with a short-lived HMAC proof from the authenticated Edge Function.';
