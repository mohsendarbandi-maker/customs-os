-- Live one-to-one WebRTC voice calls for organization chat.
create table if not exists public.chat_voice_calls (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  caller_id uuid not null references auth.users(id) on delete cascade,
  callee_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'ringing'
    check (status in ('ringing','accepted','active','rejected','cancelled','ended','missed')),
  answered_at timestamptz null,
  ended_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (caller_id <> callee_id)
);

create index if not exists chat_voice_calls_participant_idx
  on public.chat_voice_calls (caller_id, callee_id, status, created_at desc);

create unique index if not exists chat_voice_calls_active_pair_idx
  on public.chat_voice_calls (least(caller_id, callee_id), greatest(caller_id, callee_id))
  where status in ('ringing','accepted','active');

alter table public.chat_voice_calls enable row level security;
grant select, insert, update on public.chat_voice_calls to authenticated;

drop policy if exists "chat_voice_calls_select" on public.chat_voice_calls;
create policy "chat_voice_calls_select"
on public.chat_voice_calls for select to authenticated
using (caller_id = (select auth.uid()) or callee_id = (select auth.uid()));

drop policy if exists "chat_voice_calls_insert" on public.chat_voice_calls;
create policy "chat_voice_calls_insert"
on public.chat_voice_calls for insert to authenticated
with check (
  caller_id = (select auth.uid())
  and organization_id = (select public.user_org_id())
  and exists (
    select 1 from public.chat_conversation_members m
    where m.conversation_id = chat_voice_calls.conversation_id
      and m.user_id = (select auth.uid())
      and m.deleted_at is null and m.left_at is null
  )
  and exists (
    select 1 from public.chat_conversation_members m
    where m.conversation_id = chat_voice_calls.conversation_id
      and m.user_id = chat_voice_calls.callee_id
      and m.deleted_at is null and m.left_at is null
  )
);

drop policy if exists "chat_voice_calls_update" on public.chat_voice_calls;
create policy "chat_voice_calls_update"
on public.chat_voice_calls for update to authenticated
using (caller_id = (select auth.uid()) or callee_id = (select auth.uid()))
with check (caller_id = (select auth.uid()) or callee_id = (select auth.uid()));

create or replace function public.protect_chat_voice_call_identity()
returns trigger
language plpgsql
as $function$
begin
  if new.caller_id is distinct from old.caller_id
     or new.callee_id is distinct from old.callee_id
     or new.organization_id is distinct from old.organization_id
     or new.conversation_id is distinct from old.conversation_id then
    raise exception 'اطلاعات طرفین تماس قابل تغییر نیست';
  end if;

  new.updated_at := now();

  if new.status in ('accepted','active') and old.status = 'ringing' then
    new.answered_at := coalesce(new.answered_at, now());
  end if;

  if new.status in ('rejected','cancelled','ended','missed') and new.ended_at is null then
    new.ended_at := now();
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_protect_chat_voice_call_identity on public.chat_voice_calls;
create trigger trg_protect_chat_voice_call_identity
before update on public.chat_voice_calls
for each row execute function public.protect_chat_voice_call_identity();

create or replace function public.chat_voice_call_realtime()
returns trigger
security definer
set search_path = public, pg_catalog, pg_temp
language plpgsql
as $function$
declare
  p jsonb := jsonb_build_object(
    'call_id', new.id,
    'organization_id', new.organization_id,
    'conversation_id', new.conversation_id,
    'caller_id', new.caller_id,
    'callee_id', new.callee_id,
    'status', new.status,
    'answered_at', new.answered_at,
    'ended_at', new.ended_at
  );
begin
  if tg_op = 'INSERT' then
    perform realtime.send(p, 'voice_invite', 'chat-voice-user:' || new.callee_id::text, true);
  elsif tg_op = 'UPDATE' and old.status is distinct from new.status then
    perform realtime.send(p, 'voice_status', 'chat-voice-user:' || new.caller_id::text, true);
    if new.callee_id is distinct from new.caller_id then
      perform realtime.send(p, 'voice_status', 'chat-voice-user:' || new.callee_id::text, true);
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_chat_voice_call_realtime on public.chat_voice_calls;
create trigger trg_chat_voice_call_realtime
after insert or update of status on public.chat_voice_calls
for each row execute function public.chat_voice_call_realtime();

revoke all on function public.chat_voice_call_realtime() from public, anon, authenticated;

drop policy if exists "chat_voice_user_select" on realtime.messages;
create policy "chat_voice_user_select"
on realtime.messages for select to authenticated
using (
  realtime.topic() = 'chat-voice-user:' || (select auth.uid())::text
  and extension = 'broadcast'
);

drop policy if exists "chat_voice_user_insert" on realtime.messages;
create policy "chat_voice_user_insert"
on realtime.messages for insert to authenticated
with check (
  realtime.topic() = 'chat-voice-user:' || (select auth.uid())::text
  and extension = 'broadcast'
);

drop policy if exists "chat_voice_call_select" on realtime.messages;
create policy "chat_voice_call_select"
on realtime.messages for select to authenticated
using (
  realtime.topic() ~ '^voice:[0-9a-fA-F-]{36}$'
  and extension = 'broadcast'
  and exists (
    select 1 from public.chat_voice_calls c
    where c.id = (substring(realtime.topic() from 7))::uuid
      and (c.caller_id = (select auth.uid()) or c.callee_id = (select auth.uid()))
      and c.status in ('ringing','accepted','active')
  )
);

drop policy if exists "chat_voice_call_insert" on realtime.messages;
create policy "chat_voice_call_insert"
on realtime.messages for insert to authenticated
with check (
  realtime.topic() ~ '^voice:[0-9a-fA-F-]{36}$'
  and extension = 'broadcast'
  and exists (
    select 1 from public.chat_voice_calls c
    where c.id = (substring(realtime.topic() from 7))::uuid
      and (c.caller_id = (select auth.uid()) or c.callee_id = (select auth.uid()))
      and c.status in ('ringing','accepted','active')
  )
);
