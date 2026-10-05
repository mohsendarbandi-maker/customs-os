-- Migration: harden chat live voice call lifecycle

update public.chat_voice_calls
set status = 'missed',
    ended_at = coalesce(ended_at, now()),
    updated_at = now()
where status = 'ringing'
  and created_at < now() - interval '60 seconds';

create or replace function public.start_chat_voice_call(
  p_organization_id uuid,
  p_conversation_id uuid,
  p_callee_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_user uuid := auth.uid();
  v_org uuid := public.user_org_id();
  v_row public.chat_voice_calls;
  v_existing public.chat_voice_calls;
begin
  if v_user is null or v_org is null then
    raise exception 'احراز هویت الزامی است';
  end if;

  if p_organization_id <> v_org then
    raise exception 'سازمان تماس معتبر نیست';
  end if;

  if p_callee_id is null or p_callee_id = v_user then
    raise exception 'مخاطب تماس معتبر نیست';
  end if;

  if not exists (
    select 1
    from public.chat_conversation_members m
    where m.conversation_id = p_conversation_id
      and m.user_id = v_user
      and m.organization_id = v_org
      and m.deleted_at is null
      and m.left_at is null
  ) then
    raise exception 'شما عضو این گفتگو نیستید';
  end if;

  if not exists (
    select 1
    from public.chat_conversation_members m
    where m.conversation_id = p_conversation_id
      and m.user_id = p_callee_id
      and m.organization_id = v_org
      and m.deleted_at is null
      and m.left_at is null
  ) then
    raise exception 'مخاطب عضو این گفتگو نیست';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      least(v_user::text, p_callee_id::text) || ':' ||
      greatest(v_user::text, p_callee_id::text),
      0
    )
  );

  update public.chat_voice_calls
  set status = case when status = 'ringing' then 'missed' else 'ended' end,
      ended_at = coalesce(ended_at, now()),
      updated_at = now()
  where status in ('ringing', 'accepted')
    and created_at < now() - interval '60 seconds'
    and (
      (caller_id = v_user and callee_id = p_callee_id)
      or
      (caller_id = p_callee_id and callee_id = v_user)
    );

  update public.chat_voice_calls
  set status = 'ended',
      ended_at = coalesce(ended_at, now()),
      updated_at = now()
  where status = 'active'
    and updated_at < now() - interval '75 seconds'
    and (
      (caller_id = v_user and callee_id = p_callee_id)
      or
      (caller_id = p_callee_id and callee_id = v_user)
    );

  select *
  into v_existing
  from public.chat_voice_calls
  where status in ('ringing', 'accepted', 'active')
    and (
      (caller_id = v_user and callee_id = p_callee_id)
      or
      (caller_id = p_callee_id and callee_id = v_user)
    )
  order by created_at desc
  limit 1;

  if found then
    return jsonb_build_object(
      'created', false,
      'call', to_jsonb(v_existing)
    );
  end if;

  insert into public.chat_voice_calls(
    organization_id,
    conversation_id,
    caller_id,
    callee_id,
    status
  )
  values(
    v_org,
    p_conversation_id,
    v_user,
    p_callee_id,
    'ringing'
  )
  returning * into v_row;

  return jsonb_build_object(
    'created', true,
    'call', to_jsonb(v_row)
  );
end;
$function$;

revoke execute on function public.start_chat_voice_call(uuid, uuid, uuid) from public;
revoke execute on function public.start_chat_voice_call(uuid, uuid, uuid) from anon;
grant execute on function public.start_chat_voice_call(uuid, uuid, uuid) to authenticated;
