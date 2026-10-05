create unique index if not exists chat_message_reactions_unique
on public.chat_message_reactions(message_id,user_id,emoji);

create unique index if not exists chat_message_pins_unique
on public.chat_message_pins(message_id);

create unique index if not exists chat_message_user_states_unique
on public.chat_message_user_states(message_id,user_id);

create or replace function public.chat_toggle_reaction(
  p_message_id uuid,
  p_emoji text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $function$
declare
  v_user_id uuid := auth.uid();
  v_org_id uuid;
  v_conversation_id uuid;
  v_rows integer := 0;
begin
  if v_user_id is null then
    raise exception 'احراز هویت الزامی است';
  end if;

  if p_message_id is null or nullif(trim(p_emoji),'') is null or length(trim(p_emoji)) > 16 then
    raise exception 'واکنش نامعتبر است';
  end if;

  select organization_id, conversation_id
    into v_org_id, v_conversation_id
  from public.chat_messages
  where id=p_message_id
    and deleted_at is null;

  if not found then
    raise exception 'پیام پیدا نشد';
  end if;

  if public.user_org_id() is distinct from v_org_id
     or not public.chat_user_is_member(v_conversation_id) then
    raise exception 'دسترسی به این گفتگو مجاز نیست';
  end if;

  delete from public.chat_message_reactions
  where message_id=p_message_id
    and user_id=v_user_id
    and emoji=trim(p_emoji);

  get diagnostics v_rows = row_count;

  if v_rows > 0 then
    return false;
  end if;

  insert into public.chat_message_reactions(
    organization_id,message_id,user_id,emoji
  )
  values(v_org_id,p_message_id,v_user_id,trim(p_emoji));

  return true;
end;
$function$;

create or replace function public.chat_toggle_pin(
  p_message_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $function$
declare
  v_user_id uuid := auth.uid();
  v_org_id uuid;
  v_conversation_id uuid;
  v_rows integer := 0;
begin
  if v_user_id is null then
    raise exception 'احراز هویت الزامی است';
  end if;

  select organization_id, conversation_id
    into v_org_id, v_conversation_id
  from public.chat_messages
  where id=p_message_id
    and deleted_at is null;

  if not found then
    raise exception 'پیام پیدا نشد';
  end if;

  if public.user_org_id() is distinct from v_org_id
     or not public.chat_user_is_member(v_conversation_id) then
    raise exception 'دسترسی به این گفتگو مجاز نیست';
  end if;

  if not public.chat_can_manage(v_conversation_id) then
    raise exception 'فقط مدیر گفتگو می‌تواند پیام را سنجاق کند';
  end if;

  delete from public.chat_message_pins
  where message_id=p_message_id;

  get diagnostics v_rows = row_count;

  if v_rows > 0 then
    return false;
  end if;

  insert into public.chat_message_pins(
    organization_id,message_id,pinned_by
  )
  values(v_org_id,p_message_id,v_user_id);

  return true;
end;
$function$;

create or replace function public.chat_toggle_star(
  p_message_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $function$
declare
  v_user_id uuid := auth.uid();
  v_org_id uuid;
  v_conversation_id uuid;
  v_rows integer := 0;
begin
  if v_user_id is null then
    raise exception 'احراز هویت الزامی است';
  end if;

  select organization_id, conversation_id
    into v_org_id, v_conversation_id
  from public.chat_messages
  where id=p_message_id
    and deleted_at is null;

  if not found then
    raise exception 'پیام پیدا نشد';
  end if;

  if public.user_org_id() is distinct from v_org_id
     or not public.chat_user_is_member(v_conversation_id) then
    raise exception 'دسترسی به این گفتگو مجاز نیست';
  end if;

  delete from public.chat_message_user_states
  where message_id=p_message_id
    and user_id=v_user_id
    and starred_at is not null;

  get diagnostics v_rows = row_count;

  if v_rows > 0 then
    return false;
  end if;

  insert into public.chat_message_user_states(
    organization_id,message_id,user_id,starred_at,deleted_at
  )
  values(v_org_id,p_message_id,v_user_id,now(),null)
  on conflict (message_id,user_id)
  do update set
    starred_at=now(),
    deleted_at=null,
    updated_at=now();

  return true;
end;
$function$;

revoke execute on function public.chat_toggle_reaction(uuid,text) from public,anon;
grant execute on function public.chat_toggle_reaction(uuid,text) to authenticated;

revoke execute on function public.chat_toggle_pin(uuid) from public,anon;
grant execute on function public.chat_toggle_pin(uuid) to authenticated;

revoke execute on function public.chat_toggle_star(uuid) from public,anon;
grant execute on function public.chat_toggle_star(uuid) to authenticated;