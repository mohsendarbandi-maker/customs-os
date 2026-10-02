-- Run in Supabase SQL editor.
-- The script deliberately uses a transaction and request.jwt.claim.sub to impersonate authenticated users.
-- It expects two active owner/admin profiles in two different organizations.
-- It does not embed production UUIDs.

begin;

do $$
declare
  v_a uuid;
  v_b uuid;
  v_user_a uuid;
  v_user_b uuid;
  v_client uuid;
begin
  select p.id, p.organization_id into v_user_a, v_a
  from public.profiles p
  where p.is_active and p.role in ('owner','admin')
  order by p.created_at
  limit 1;

  select p.id, p.organization_id into v_user_b, v_b
  from public.profiles p
  where p.is_active and p.role in ('owner','admin')
    and p.organization_id <> v_a
  order by p.created_at
  limit 1;

  if v_user_a is null or v_user_b is null then
    raise exception 'Need two active owner/admin profiles in two organizations';
  end if;

  select p.id into v_client
  from public.profiles p
  where p.organization_id = v_a and p.is_active and p.role = 'client'
  limit 1;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  perform set_config('request.jwt.claim.sub', v_user_a::text, true);
  begin
    insert into public.org_connections(
      source_organization_id,target_organization_id,relationship_type,status,requested_by
    ) values (v_b,v_a,'partner','pending',v_user_a);
    raise exception 'FAIL: cross-organization request spoof was accepted';
  exception when others then
    raise notice 'PASS: cross-organization request spoof blocked: %', sqlerrm;
  end;

  if v_client is not null then
    perform set_config('request.jwt.claim.sub', v_client::text, true);
    begin
      insert into public.org_connections(
        source_organization_id,target_organization_id,relationship_type,status,requested_by
      ) values (v_a,v_b,'partner','pending',v_client);
      raise exception 'FAIL: client created connection';
    exception when others then
      raise notice 'PASS: client creation blocked: %', sqlerrm;
    end;
  end if;

  perform set_config('request.jwt.claim.sub', v_user_a::text, true);
  insert into public.org_connections(
    source_organization_id,target_organization_id,relationship_type,status,requested_by
  ) values (v_a,v_b,'partner','pending',v_user_a);

  if not exists (
    select 1 from public.org_connections c
    where c.source_organization_id=v_a and c.target_organization_id=v_b and c.status='pending'
  ) then
    raise exception 'FAIL: own pending request not visible';
  end if;

  perform set_config('request.jwt.claim.sub', v_user_b::text, true);
  update public.org_connections c
     set status='accepted'
   where c.source_organization_id=v_a
     and c.target_organization_id=v_b
     and c.status='pending';

  if not exists (
    select 1 from public.org_connections c
    where c.source_organization_id=v_a and c.target_organization_id=v_b and c.status='accepted'
  ) then
    raise exception 'FAIL: target manager could not accept';
  end if;
end
$$;

rollback;
