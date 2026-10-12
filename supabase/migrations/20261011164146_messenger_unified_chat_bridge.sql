begin;

alter table public.messenger_chats
  add column if not exists conversation_id uuid references public.chat_conversations(id) on delete set null;
create index if not exists messenger_chats_conversation_idx
  on public.messenger_chats(organization_id,conversation_id)
  where conversation_id is not null;

create or replace function public.messenger_validate_chat_conversation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
begin
  if new.conversation_id is not null and not exists (
    select 1
    from public.chat_conversations c
    where c.id = new.conversation_id
      and c.organization_id = new.organization_id
      and c.deleted_at is null
  ) then
    raise exception 'CONVERSATION_ORGANIZATION_MISMATCH';
  end if;
  return new;
end;
$$;
revoke all on function public.messenger_validate_chat_conversation() from public, anon, authenticated;
drop trigger if exists trg_messenger_validate_chat_conversation on public.messenger_chats;
create trigger trg_messenger_validate_chat_conversation
before insert or update of conversation_id, organization_id
on public.messenger_chats
for each row execute function public.messenger_validate_chat_conversation();

alter table public.chat_messages alter column sender_id drop not null;
alter table public.chat_messages add column if not exists external_platform text;
alter table public.chat_messages add column if not exists external_connection_id uuid references public.messenger_connections(id) on delete set null;
alter table public.chat_messages add column if not exists external_chat_id text;
alter table public.chat_messages add column if not exists external_message_id text;
alter table public.chat_messages add column if not exists external_sender_id text;
alter table public.chat_messages add column if not exists external_sender_name text;
alter table public.chat_messages drop constraint if exists chat_messages_external_platform_check;
alter table public.chat_messages
  add constraint chat_messages_external_platform_check
  check (external_platform is null or external_platform in ('telegram','bale','whatsapp'));
create unique index if not exists chat_messages_external_dedupe_idx
  on public.chat_messages(external_connection_id,external_chat_id,external_message_id)
  where external_message_id is not null and external_connection_id is not null and external_chat_id is not null;
create index if not exists chat_messages_external_sender_idx
  on public.chat_messages(external_connection_id,external_sender_id,created_at desc)
  where external_sender_id is not null;

alter table public.message_logs
  add column if not exists chat_message_id uuid references public.chat_messages(id) on delete set null;
create index if not exists message_logs_chat_message_idx
  on public.message_logs(chat_message_id) where chat_message_id is not null;

create table if not exists public.messenger_delivery_outbox (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  connection_id uuid not null references public.messenger_connections(id) on delete cascade,
  messenger_chat_id uuid not null references public.messenger_chats(id) on delete cascade,
  chat_message_id uuid not null references public.chat_messages(id) on delete cascade,
  external_chat_id text not null,
  status text not null default 'queued'
    check (status in ('queued','sending','sent','delivered','read','failed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  external_message_id text,
  last_error_code text,
  next_attempt_at timestamptz not null default now(),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(messenger_chat_id,chat_message_id)
);
create index if not exists messenger_delivery_outbox_due_idx
  on public.messenger_delivery_outbox(status,next_attempt_at,created_at);

alter table public.messenger_delivery_outbox enable row level security;
revoke all on public.messenger_delivery_outbox from public, anon, authenticated;
grant all on public.messenger_delivery_outbox to service_role;

create or replace function public.messenger_claim_delivery_outbox(p_limit integer default 50)
returns setof public.messenger_delivery_outbox
language sql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
  with picked as (
    select o.id
    from public.messenger_delivery_outbox o
    where o.status in ('queued','failed')
      and o.next_attempt_at <= now()
      and o.attempt_count < 12
    order by o.created_at, o.id
    for update skip locked
    limit greatest(1, least(coalesce(p_limit,50),100))
  )
  update public.messenger_delivery_outbox o
  set status='sending', attempt_count=o.attempt_count+1, last_error_code=null, updated_at=now()
  from picked
  where o.id=picked.id
  returning o.*;
$$;
revoke all on function public.messenger_claim_delivery_outbox(integer) from public, anon, authenticated;
grant execute on function public.messenger_claim_delivery_outbox(integer) to service_role;

create or replace function public.messenger_enqueue_chat_delivery()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
begin
  if new.sender_id is null or new.message_type='system' or new.external_platform is not null then
    return new;
  end if;
  insert into public.messenger_delivery_outbox(
    organization_id,connection_id,messenger_chat_id,chat_message_id,external_chat_id,status,next_attempt_at
  )
  select
    mc.organization_id,mc.connection_id,mc.id,new.id,mc.external_chat_id,'queued',now()
  from public.messenger_chats mc
  join public.messenger_connections conn
    on conn.id=mc.connection_id
   and conn.organization_id=mc.organization_id
   and conn.enabled=true
  where mc.organization_id=new.organization_id
    and mc.conversation_id=new.conversation_id
    and mc.enabled=true
    and mc.purpose='inbox'
  on conflict(messenger_chat_id,chat_message_id) do nothing;
  return new;
end;
$$;
revoke all on function public.messenger_enqueue_chat_delivery() from public, anon, authenticated;
drop trigger if exists trg_messenger_enqueue_chat_delivery on public.chat_messages;
create trigger trg_messenger_enqueue_chat_delivery
after insert on public.chat_messages
for each row execute function public.messenger_enqueue_chat_delivery();

create or replace function public.chat_enqueue_message_notifications()
returns trigger
language plpgsql
security definer
set search_path = public, net, vault, pg_catalog, pg_temp
as $function$
declare
  v_push_secret text;
begin
  if new.message_type='system' then
    return new;
  end if;

  insert into public.notification_outbox(
    organization_id,user_id,conversation_id,message_id,tag,title,body,url,payload
  )
  select
    p.organization_id,m.user_id,new.conversation_id,new.id,
    'chat-'||new.conversation_id::text,
    coalesce(sender.full_name,new.external_sender_name,'پیام جدید'),
    case when np.hide_content then null else left(coalesce(new.body,''),180) end,
    '/chat?conversation='||new.conversation_id::text,
    jsonb_build_object(
      'conversationId',new.conversation_id,
      'messageId',new.id,
      'senderName',coalesce(sender.full_name,new.external_sender_name,'')
    )
  from public.chat_conversation_members m
  join public.profiles p on p.id=m.user_id and p.is_active=true
  join public.chat_conversations c on c.id=new.conversation_id
  left join public.profiles sender on sender.id=new.sender_id and sender.is_active=true
  left join public.notification_preferences np on np.user_id=m.user_id
  where m.conversation_id=new.conversation_id
    and (new.sender_id is null or m.user_id<>new.sender_id)
    and m.deleted_at is null and m.left_at is null
  on conflict(user_id,message_id) do nothing;

  v_push_secret:=public.internal_get_reminder_secret('chat_push_cron_secret');
  if v_push_secret is not null then
    perform net.http_post(
      'https://bjngfgiecvihofemptub.supabase.co/functions/v1/send-chat-push',
      '{}'::jsonb,'{}'::jsonb,
      jsonb_build_object('Content-Type','application/json','x-chat-push-cron-secret',v_push_secret),10000
    );
  end if;
  return new;
end
$function$;

create or replace function public.chat_mark_read(p_conversation_id uuid, p_message_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $function$
declare
  v_user uuid := auth.uid();
  v_org uuid;
  v_created_at timestamptz;
begin
  if v_user is null then raise exception 'احراز هویت الزامی است'; end if;
  if not public.chat_user_is_member(p_conversation_id) then raise exception 'عضویت در مکالمه الزامی است'; end if;
  select m.organization_id,m.created_at into v_org,v_created_at
  from public.chat_messages m
  where m.id=p_message_id and m.conversation_id=p_conversation_id and m.deleted_at is null;
  if v_created_at is null then raise exception 'پیام نامعتبر است'; end if;
  update public.chat_conversation_members
     set last_read_message_id=p_message_id,updated_at=now()
   where conversation_id=p_conversation_id and user_id=v_user and deleted_at is null and left_at is null;
  insert into public.chat_message_receipts(
    organization_id,message_id,user_id,status,delivered_at,read_at,played_at
  )
  select m.organization_id,m.id,v_user,'read',coalesce(r.delivered_at,now()),now(),r.played_at
  from public.chat_messages m
  left join public.chat_message_receipts r on r.message_id=m.id and r.user_id=v_user
  where m.conversation_id=p_conversation_id and m.deleted_at is null
    and (m.sender_id is null or m.sender_id<>v_user)
    and (m.created_at<v_created_at or (m.created_at=v_created_at and m.id<=p_message_id))
  on conflict(message_id,user_id) do update
    set status='read',
        read_at=coalesce(public.chat_message_receipts.read_at,now()),
        delivered_at=coalesce(public.chat_message_receipts.delivered_at,now()),
        played_at=public.chat_message_receipts.played_at,
        updated_at=now();
end;
$function$;

revoke all on function public.chat_mark_read(uuid,uuid) from public, anon;
grant execute on function public.chat_mark_read(uuid,uuid) to authenticated;

commit;