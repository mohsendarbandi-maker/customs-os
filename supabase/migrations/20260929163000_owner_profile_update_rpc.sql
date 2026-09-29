create or replace function public.owner_update_profile(
  p_user_id uuid,
  p_role public.user_role default null,
  p_client_id uuid default null,
  p_full_name text default null,
  p_phone text default null,
  p_is_active boolean default null
)
returns public.profiles
language plpgsql
security definer
set search_path=public,pg_catalog,pg_temp
as $$
declare
  v_org uuid:=public.user_org_id();
  v_old public.profiles;
  v_row public.profiles;
begin
  if auth.uid() is null or public.user_role()<>'owner'::public.user_role then
    raise exception 'Only the organization owner can update user profiles';
  end if;
  select * into v_old from public.profiles where id=p_user_id and organization_id=v_org for update;
  if not found then raise exception 'User profile not found'; end if;
  if p_client_id is not null and not exists(select 1 from public.clients c where c.id=p_client_id and c.organization_id=v_org) then
    raise exception 'Client association does not belong to the organization';
  end if;
  update public.profiles
  set role=coalesce(p_role,role),
      client_id=case when p_client_id is null then client_id else p_client_id end,
      full_name=coalesce(nullif(trim(p_full_name),''),full_name),
      phone=case when p_phone is null then phone else nullif(trim(p_phone),'') end,
      is_active=coalesce(p_is_active,is_active),
      updated_at=now()
  where id=p_user_id and organization_id=v_org
  returning * into v_row;
  return v_row;
end;
$$;
revoke all on function public.owner_update_profile(uuid,public.user_role,uuid,text,text,boolean) from public,anon,authenticated;
grant execute on function public.owner_update_profile(uuid,public.user_role,uuid,text,text,boolean) to authenticated;