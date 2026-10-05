-- Organization connections for cross-company Chat.
-- Only organization managers can create/accept/cancel connections.
-- The RPC exposes names only for organizations participating in a connection.

create or replace function public.chat_list_org_connections()
returns table(
  id uuid,
  source_organization_id uuid,
  target_organization_id uuid,
  relationship_type text,
  status text,
  requested_by uuid,
  accepted_by uuid,
  created_at timestamptz,
  updated_at timestamptz,
  source_name text,
  target_name text
)
language sql
stable
security definer
set search_path=public,pg_catalog,pg_temp
as $$
  select
    c.id,
    c.source_organization_id,
    c.target_organization_id,
    c.relationship_type,
    c.status,
    c.requested_by,
    c.accepted_by,
    c.created_at,
    c.updated_at,
    so.name as source_name,
    to2.name as target_name
  from public.org_connections c
  join public.organizations so on so.id=c.source_organization_id
  join public.organizations to2 on to2.id=c.target_organization_id
  where (c.source_organization_id=public.user_org_id() or c.target_organization_id=public.user_org_id())
    and c.deleted_at is null
    and auth.uid() is not null;
$$;

revoke all on function public.chat_list_org_connections() from public,anon;
grant execute on function public.chat_list_org_connections() to authenticated;
