alter table public.file_scans add column if not exists attempts integer not null default 0;
create index if not exists file_scans_claim_idx on public.file_scans(status,created_at);
create or replace function public.claim_file_scans(p_limit integer default 25)
returns table(id uuid,organization_id uuid,attachment_id uuid,attempts integer)
language plpgsql security definer set search_path=public,pg_catalog,pg_temp as $$
begin return query with c as(
 select f.ctid,f.id,f.organization_id,f.attachment_id,f.attempts
 from public.file_scans f where f.status='scanning' and f.attempts<3
 order by f.created_at for update skip locked limit greatest(1,least(coalesce(p_limit,25),100))
) update public.file_scans f set attempts=f.attempts+1,started_at=coalesce(f.started_at,now())
from c where f.ctid=c.ctid returning f.id,f.organization_id,f.attachment_id,f.attempts; end $$;
revoke all on function public.claim_file_scans(integer) from public,anon,authenticated;
grant execute on function public.claim_file_scans(integer) to service_role;