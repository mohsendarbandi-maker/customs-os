revoke update on public.ai_operator_commands from anon, authenticated;

drop function if exists public.ai_operator_transition_command(uuid,text,timestamptz,timestamptz,jsonb,text,jsonb,jsonb,uuid,timestamptz);

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
set search_path=public,pg_catalog,pg_temp
as $$
declare
  v_old public.ai_operator_commands;
  v_new public.ai_operator_commands;
  v_uid uuid:=auth.uid();
  v_allowed boolean:=false;
begin
  if v_uid is null then raise exception 'کاربر وارد سامانه نشده است'; end if;
  select * into v_old from public.ai_operator_commands where id=p_command_id for update;
  if not found or v_old.user_id<>v_uid then raise exception 'دستور پیدا نشد یا دسترسی ندارید'; end if;
  if v_old.status='executed' then raise exception 'دستور اجراشده قابل تغییر نیست'; end if;

  v_allowed :=
    (v_old.status='proposed' and p_status in ('awaiting_confirmation','executing','clarification_needed','cancelled','rejected')) or
    (v_old.status='awaiting_confirmation' and p_status in ('awaiting_confirmation','executing','clarification_needed','cancelled','rejected')) or
    (v_old.status='executing' and p_status in ('executed','failed','clarification_needed'));

  if not v_allowed then raise exception 'انتقال وضعیت AI Operator مجاز نیست'; end if;

  update public.ai_operator_commands
  set status=p_status,
      confirmation_at=coalesce(p_confirmation_at,confirmation_at),
      final_confirmation_at=coalesce(p_final_confirmation_at,final_confirmation_at),
      before_data=coalesce(p_before_data,before_data),
      after_data=coalesce(p_after_data,after_data),
      result=coalesce(p_result,result),
      error_message=coalesce(p_error_message,error_message),
      executed_by=coalesce(p_executed_by,executed_by),
      executed_at=coalesce(p_executed_at,executed_at),
      updated_at=now()
  where id=p_command_id
  returning * into v_new;

  return v_new;
end;
$$;

revoke all on function public.ai_operator_transition_command(uuid,text,timestamptz,timestamptz,jsonb,text,jsonb,jsonb,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.ai_operator_transition_command(uuid,text,timestamptz,timestamptz,jsonb,text,jsonb,jsonb,uuid,timestamptz) to authenticated;

drop trigger if exists tr_ai_operator_command_tamper on public.ai_operator_commands;
create or replace function public.prevent_ai_operator_command_tampering()
returns trigger
language plpgsql
set search_path=public,pg_catalog,pg_temp
as $$
begin
  if new.organization_id is distinct from old.organization_id
    or new.user_id is distinct from old.user_id
    or new.session_id is distinct from old.session_id
    or new.natural_command is distinct from old.natural_command
    or new.page_context is distinct from old.page_context
    or new.module is distinct from old.module
    or new.action_code is distinct from old.action_code
    or new.target is distinct from old.target
    or new.plan is distinct from old.plan
    or new.confidence is distinct from old.confidence
    or new.risk_level is distinct from old.risk_level
    or new.created_at is distinct from old.created_at
    or new.final_confirmation_phrase is distinct from old.final_confirmation_phrase
  then raise exception 'AI Operator command plan is immutable after creation'; end if;
  if old.status='executed' then raise exception 'Executed AI Operator command is immutable'; end if;
  return new;
end;
$$;

create trigger tr_ai_operator_command_tamper
before update on public.ai_operator_commands
for each row execute function public.prevent_ai_operator_command_tampering();