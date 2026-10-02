-- Audit guest isolation: demo-only, read-only, profile-backed enforcement.
-- Live schema was applied separately; keep this migration as the source-of-truth record.

alter table public.profiles
  add column if not exists is_audit_guest boolean not null default false;

create or replace function public.block_audit_guest_writes()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
begin
  if exists (
    select 1 from public.profiles
    where id = auth.uid()
      and is_audit_guest = true
      and is_active = true
  ) then
    raise exception 'Audit guest is read-only';
  end if;
  return coalesce(NEW, OLD);
end;
$function$;

revoke execute on function public.block_audit_guest_writes() from public, anon, authenticated;

create or replace function public.create_audit_guest_profile()
returns public.profiles
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $function$
declare result public.profiles; v_demo_org uuid; v_demo_client uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if coalesce((auth.jwt()->>'is_anonymous')::boolean,false) is not true then
    raise exception 'Audit guest profile is only available to anonymous sessions';
  end if;
  select id into v_demo_org from public.organizations where name='Customs OS Demo' limit 1;
  if v_demo_org is null then raise exception 'Demo organization is not configured'; end if;
  select id into v_demo_client from public.clients where organization_id=v_demo_org and name='Demo Importer' limit 1;
  if v_demo_client is null then raise exception 'Demo client is not configured'; end if;

  select * into result from public.profiles where id=auth.uid();
  if found then
    if result.is_audit_guest and result.organization_id=v_demo_org
       and result.role='client'::public.user_role and result.is_active then return result; end if;
    raise exception 'Authenticated user already has a protected profile; guest profile cannot change organization or role';
  end if;

  insert into public.profiles(id,organization_id,role,client_id,full_name,is_active,is_audit_guest)
  values(auth.uid(),v_demo_org,'client'::public.user_role,v_demo_client,'Audit Guest',true,true)
  on conflict(id) do nothing returning * into result;

  if result.id is null then
    select * into result from public.profiles where id=auth.uid();
    if not result.is_audit_guest or result.organization_id<>v_demo_org
       or result.role<>'client'::public.user_role or not result.is_active then
      raise exception 'Existing profile cannot be converted into an audit guest';
    end if;
  end if;
  return result;
end;
$function$;

revoke execute on function public.create_audit_guest_profile() from public, anon;
grant execute on function public.create_audit_guest_profile() to authenticated;

-- The following policies intentionally target authenticated sessions only.
alter policy "ai_knowledge_chunks_org" on public.ai_knowledge_chunks to authenticated;
alter policy "ai_knowledge_documents_org" on public.ai_knowledge_documents to authenticated;
alter policy "document_extraction_fields_delete" on public.document_extraction_fields to authenticated;
alter policy "document_extraction_fields_insert" on public.document_extraction_fields to authenticated;
alter policy "document_extraction_fields_select" on public.document_extraction_fields to authenticated;
alter policy "document_extraction_fields_update" on public.document_extraction_fields to authenticated;

revoke all on table public.ais_sync_health from anon, authenticated;
comment on table public.ais_sync_health is 'Internal synchronization health table. RLS enabled with no client policies; client roles have no table grants. Trusted server/service_role only.';

-- Existing audit-guest accounts were retired during incident cleanup.
-- Seeded demo data is intentionally synthetic and contains no production customer data.
