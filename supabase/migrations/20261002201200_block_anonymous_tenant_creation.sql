create or replace function public.create_tenant_account(org_name text, user_full_name text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $function$
declare new_org_id uuid; clean_org_name text; clean_user_name text;
begin
  if auth.uid() is null then raise exception 'Authentication required to initialize tenant'; end if;
  if coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then
    raise exception 'Anonymous audit guests cannot create tenants';
  end if;
  clean_org_name:=trim(org_name); clean_user_name:=trim(user_full_name);
  if char_length(clean_org_name)<2 or char_length(clean_org_name)>255 then raise exception 'Organization name must be between 2 and 255 characters'; end if;
  if char_length(clean_user_name)<2 or char_length(clean_user_name)>255 then raise exception 'Full name must be between 2 and 255 characters'; end if;
  if exists(select 1 from public.profiles where id=auth.uid()) then raise exception 'User profile already exists in an organization'; end if;
  insert into public.organizations(name) values(clean_org_name) returning id into new_org_id;
  insert into public.profiles(id,organization_id,role,full_name,is_active,client_id,is_audit_guest)
  values(auth.uid(),new_org_id,'owner',clean_user_name,true,null,false);
  return new_org_id;
end;
$function$;