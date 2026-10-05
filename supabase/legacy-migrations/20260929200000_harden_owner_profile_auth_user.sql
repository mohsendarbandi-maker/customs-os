create or replace function public.owner_insert_profile(
  p_user_id uuid,
  p_role public.user_role,
  p_client_id uuid,
  p_full_name text,
  p_phone text default null
)
returns public.profiles
language plpgsql
security definer
set search_path=public,pg_catalog,pg_temp
as $$
declare
  v_org uuid:=public.user_org_id();
  v_row public.profiles;
begin
  if auth.uid() is null or public.user_role() <> 'owner'::public.user_role then
    raise exception 'Only the organization owner can create user profiles';
  end if;
  if p_user_id is null or v_org is null then
    raise exception 'User and organization are required';
  end if;
  if not exists(select 1 from auth.users u where u.id=p_user_id) then
    raise exception 'Auth user not found; create or invite the Auth account first';
  end if;
  if p_client_id is not null and not exists(
    select 1 from public.clients c
    where c.id=p_client_id and c.organization_id=v_org
  ) then
    raise exception 'Client association does not belong to the organization';
  end if;
  insert into public.profiles(
    id,organization_id,role,client_id,full_name,phone,is_active,created_at,updated_at
  )
  values(
    p_user_id,v_org,p_role,p_client_id,nullif(trim(p_full_name),''),nullif(trim(p_phone),''),true,now(),now()
  )
  returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.owner_insert_profile(uuid,public.user_role,uuid,text,text) from public,anon,authenticated;
grant execute on function public.owner_insert_profile(uuid,public.user_role,uuid,text,text) to authenticated;
