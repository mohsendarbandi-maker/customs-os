create table if not exists public.user_device_sessions (
  session_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  device_label text not null default 'دستگاه ثبت‌شده',
  user_agent text,
  app_origin text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index if not exists user_device_sessions_user_last_seen_idx
  on public.user_device_sessions (user_id, last_seen_at desc);

alter table public.user_device_sessions enable row level security;

grant select, insert, update on public.user_device_sessions to authenticated;

drop policy if exists "Users can read their own device sessions" on public.user_device_sessions;
create policy "Users can read their own device sessions"
  on public.user_device_sessions for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can register their own device sessions" on public.user_device_sessions;
create policy "Users can register their own device sessions"
  on public.user_device_sessions for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own device sessions" on public.user_device_sessions;
create policy "Users can update their own device sessions"
  on public.user_device_sessions for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create or replace function public.prevent_user_device_session_reactivation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if old.revoked_at is not null and new.revoked_at is null then
    raise exception 'A revoked device session cannot be reactivated';
  end if;
  return new;
end;
$$;

revoke all on function public.prevent_user_device_session_reactivation() from public, anon, authenticated;

drop trigger if exists prevent_user_device_session_reactivation on public.user_device_sessions;
create trigger prevent_user_device_session_reactivation
  before update on public.user_device_sessions
  for each row execute function public.prevent_user_device_session_reactivation();

insert into public.user_device_sessions (
  session_id, user_id, device_label, user_agent, app_origin, created_at, last_seen_at
)
select
  s.id,
  s.user_id,
  coalesce(nullif(btrim(s.user_agent), ''), 'دستگاه ثبت‌شده قبلی'),
  s.user_agent,
  null,
  s.created_at,
  coalesce(s.refreshed_at::timestamptz, s.updated_at, s.created_at)
from auth.sessions as s
on conflict (session_id) do nothing;

create or replace function public.list_my_auth_sessions()
returns table (
  session_id uuid,
  created_at timestamptz,
  last_active_at timestamptz,
  user_agent text,
  device_label text,
  app_origin text,
  is_current boolean,
  revoke_requested_at timestamptz
)
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select
    s.id,
    s.created_at,
    coalesce(s.refreshed_at::timestamptz, s.updated_at, s.created_at),
    s.user_agent,
    coalesce(nullif(d.device_label, ''), 'دستگاه ثبت‌شده'),
    d.app_origin,
    s.id = nullif(auth.jwt() ->> 'session_id', '')::uuid,
    d.revoked_at
  from auth.sessions as s
  left join public.user_device_sessions as d
    on d.session_id = s.id
   and d.user_id = s.user_id
  where auth.uid() is not null
    and s.user_id = auth.uid()
    and (s.not_after is null or s.not_after > now())
  order by coalesce(s.refreshed_at::timestamptz, s.updated_at, s.created_at) desc;
$$;

revoke all on function public.list_my_auth_sessions() from public, anon;
grant execute on function public.list_my_auth_sessions() to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'user_device_sessions'
     ) then
    alter publication supabase_realtime add table public.user_device_sessions;
  end if;
end;
$$;
