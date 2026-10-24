-- Telegram owner topics for private, Telegram-backed document archiving.
-- Binary content remains in Telegram; Supabase stores only mapping/metadata.
alter table public.messenger_chats
  add column if not exists client_id uuid null references public.clients(id) on delete set null;

create index if not exists messenger_chats_org_client_idx
  on public.messenger_chats (organization_id, client_id)
  where client_id is not null;

create table if not exists public.messenger_archive_topics (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  connection_id uuid not null references public.messenger_connections(id) on delete cascade,
  external_chat_id text not null,
  topic_key text not null,
  client_id uuid null references public.clients(id) on delete cascade,
  topic_id bigint null,
  topic_name text not null,
  status text not null default 'creating'
    check (status in ('creating', 'ready', 'failed')),
  last_error_code text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint messenger_archive_topics_unique
    unique (organization_id, connection_id, external_chat_id, topic_key)
);

create index if not exists messenger_archive_topics_org_client_idx
  on public.messenger_archive_topics (organization_id, client_id, status);

alter table public.messenger_archive_topics enable row level security;
revoke all on table public.messenger_archive_topics from public, anon, authenticated;
grant all on table public.messenger_archive_topics to service_role;

comment on table public.messenger_archive_topics is
  'Server-only mapping from a Telegram file archive supergroup to one forum topic per cargo owner. Shipments are grouped within the owner topic using captions and searchable hashtags; Telegram topics cannot be nested.';
