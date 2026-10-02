-- Phase 3: Chat core, membership-driven RLS, keyset pagination, search and notification outbox.
create extension if not exists pg_trgm;

create table if not exists public.chat_conversations (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references public.organizations(id),
  type text not null check (type in ('direct','group','company_channel','related','shared_company')),
  title text,
  related_type text,
  related_id uuid,
  shared_with_organization_id uuid references public.organizations(id),
  org_connection_id uuid references public.org_connections(id),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists chat_conversations_org_idx
  on public.chat_conversations(organization_id, updated_at desc, id desc);
create index if not exists chat_conversations_shared_org_idx
  on public.chat_conversations(shared_with_organization_id, updated_at desc)
  where shared_with_organization_id is not null;
create index if not exists chat_conversations_related_idx
  on public.chat_conversations(related_type, related_id)
  where related_id is not null;

create table if not exists public.chat_conversation_members (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references public.organizations(id),
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  role text not null check (role in ('owner','admin','member','guest')),
  muted_until timestamptz,
  last_read_message_id uuid,
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists chat_conversation_members_active_unique
  on public.chat_conversation_members(conversation_id, user_id)
  where deleted_at is null;
create index if not exists chat_members_user_idx
  on public.chat_conversation_members(user_id, deleted_at, conversation_id);
create index if not exists chat_members_conversation_idx
  on public.chat_conversation_members(conversation_id, deleted_at, role);

create table if not exists public.chat_messages (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references public.organizations(id),
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id),
  client_uuid uuid not null,
  message_type text not null default 'text' check (message_type in ('text','system','file','voice')),
  body text,
  reply_to_message_id uuid references public.chat_messages(id),
  forwarded_from_message_id uuid references public.chat_messages(id),
  thread_root_message_id uuid references public.chat_messages(id),
  delivery_status text not null default 'sent' check (delivery_status in ('sending','sent','delivered','read','failed')),
  edited_at timestamptz,
  deleted_at timestamptz,
  deleted_for_all_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chat_messages_body_check check (
    message_type in ('file','voice','system') or nullif(trim(body),'') is not null
  ),
  constraint chat_messages_client_uuid_unique unique (conversation_id, client_uuid)
);

create index if not exists chat_messages_conversation_keyset_idx
  on public.chat_messages(conversation_id, created_at desc, id desc);
create index if not exists chat_messages_sender_idx
  on public.chat_messages(sender_id, created_at desc);
create index if not exists chat_messages_reply_idx
  on public.chat_messages(reply_to_message_id)
  where reply_to_message_id is not null;
create index if not exists chat_messages_thread_idx
  on public.chat_messages(thread_root_message_id, created_at asc)
  where thread_root_message_id is not null;

create or replace function public.chat_normalize_text(p_text text)
returns text
language sql
immutable
parallel safe
set search_path = public, pg_catalog, pg_temp
as $$
  select lower(
    replace(
      replace(
        replace(
          translate(coalesce(p_text,''),'يىيكك','یییکک'),
          '‌',' '
        ),
        '٠١٢٣٤٥٦٧٨٩','۰۱۲۳۴۵۶۷۸۹'
      ),
      'ـ',''
    )
  );
$$;

create index if not exists chat_messages_fts_idx
  on public.chat_messages using gin (
    to_tsvector('simple', public.chat_normalize_text(coalesce(body,'')))
  );
create index if not exists chat_messages_trgm_idx
  on public.chat_messages using gin (
    public.chat_normalize_text(coalesce(body,'')) gin_trgm_ops
  );

create table if not exists public.chat_message_user_states (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references public.organizations(id),
  message_id uuid not null references public.chat_messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  starred_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists chat_message_user_states_unique
  on public.chat_message_user_states(message_id, user_id);
create index if not exists chat_message_user_states_user_idx
  on public.chat_message_user_states(user_id, deleted_at, starred_at desc);

create table if not exists public.chat_message_reactions (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references public.organizations(id),
  message_id uuid not null references public.chat_messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  emoji text not null check (length(emoji) between 1 and 16),
  created_at timestamptz not null default now()
);
create unique index if not exists chat_message_reactions_unique
  on public.chat_message_reactions(message_id, user_id, emoji);
create index if not exists chat_message_reactions_message_idx
  on public.chat_message_reactions(message_id, created_at);

create table if not exists public.chat_message_mentions (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references public.organizations(id),
  message_id uuid not null references public.chat_messages(id) on delete cascade,
  mentioned_user_id uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
create unique index if not exists chat_message_mentions_unique
  on public.chat_message_mentions(message_id, mentioned_user_id);

create table if not exists public.chat_message_pins (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references public.organizations(id),
  message_id uuid not null references public.chat_messages(id) on delete cascade,
  pinned_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
create unique index if not exists chat_message_pins_unique
  on public.chat_message_pins(message_id);

create table if not exists public.chat_message_receipts (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references public.organizations(id),
  message_id uuid not null references public.chat_messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  status text not null check (status in ('delivered','read')),
  delivered_at timestamptz,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists chat_message_receipts_unique
  on public.chat_message_receipts(message_id, user_id);
create index if not exists chat_message_receipts_message_idx
  on public.chat_message_receipts(message_id, status);

create table if not exists public.chat_attachments (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references public.organizations(id),
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  message_id uuid not null references public.chat_messages(id) on delete cascade,
  storage_path text not null unique,
  original_name text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 52428800),
  thumbnail_path text,
  duration_seconds numeric(12,3),
  waveform jsonb,
  security_status text not null default 'scanning' check (security_status in ('scanning','clean','blocked')),
  security_checked_at timestamptz,
  security_error text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists chat_attachments_conversation_idx
  on public.chat_attachments(conversation_id, created_at desc);
create index if not exists chat_attachments_security_idx
  on public.chat_attachments(security_status, created_at asc);

create table if not exists public.file_scans (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references public.organizations(id),
  attachment_id uuid not null references public.chat_attachments(id) on delete cascade,
  status text not null check (status in ('scanning','clean','blocked','error')),
  local_result jsonb,
  provider text,
  provider_result jsonb,
  sha256 text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists file_scans_attachment_idx on public.file_scans(attachment_id, created_at desc);
create index if not exists file_scans_hash_idx on public.file_scans(sha256) where sha256 is not null;

create table if not exists public.notification_outbox (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references public.organizations(id),
  user_id uuid not null references public.profiles(id),
  conversation_id uuid,
  message_id uuid,
  tag text not null,
  title text not null,
  body text,
  url text not null,
  payload jsonb not null default '{}'::jsonb,
  scheduled_at timestamptz not null default now(),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists notification_outbox_message_user_unique
  on public.notification_outbox(user_id, message_id)
  where message_id is not null;
create index if not exists notification_outbox_pending_idx
  on public.notification_outbox(next_attempt_at asc, created_at asc)
  where sent_at is null;

create table if not exists public.chat_user_focus (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  organization_id uuid not null references public.organizations(id),
  conversation_id uuid references public.chat_conversations(id) on delete set null,
  focused_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists chat_user_focus_conversation_idx
  on public.chat_user_focus(conversation_id, updated_at desc)
  where conversation_id is not null;

create or replace function public.chat_user_is_member(p_conversation_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog, pg_temp
as $$
  select exists (
    select 1
    from public.chat_conversation_members m
    where m.conversation_id = p_conversation_id
      and m.user_id = coalesce(p_user_id, auth.uid())
      and m.deleted_at is null
      and m.left_at is null
      and exists (
        select 1
        from public.profiles p
        where p.id=m.user_id and p.is_active=true
      )
  );
$$;

create or replace function public.chat_can_manage(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog, pg_temp
as $$
  select exists (
    select 1
    from public.chat_conversation_members m
    join public.profiles p on p.id=m.user_id
    where m.conversation_id=p_conversation_id
      and m.user_id=auth.uid()
      and m.deleted_at is null
      and m.left_at is null
      and p.is_active
      and m.role in ('owner','admin')
      and p.role::text <> 'client'
  );
$$;

create or replace function public.chat_connection_allowed_for_conversation(
  p_conversation_id uuid,
  p_organization_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog, pg_temp
as $$
  select exists (
    select 1 from public.chat_conversations c
    where c.id=p_conversation_id
      and (
        c.organization_id=p_organization_id
        or (
          c.shared_with_organization_id=p_organization_id
          and c.type='shared_company'
          and c.org_connection_id is not null
          and public.orgs_are_connected(c.organization_id,p_organization_id)
        )
      )
  );
$$;

create or replace function public.chat_create_conversation(
  p_type text,
  p_title text default null,
  p_related_type text default null,
  p_related_id uuid default null,
  p_shared_with_organization_id uuid default null,
  p_org_connection_id uuid default null
)
returns public.chat_conversations
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_org uuid := public.user_org_id();
  v_row public.chat_conversations;
  v_existing uuid;
begin
  if v_user is null or v_org is null then raise exception 'احراز هویت الزامی است'; end if;
  if p_type not in ('direct','group','company_channel','related','shared_company') then raise exception 'نوع مکالمه نامعتبر است'; end if;

  if p_type='direct' then
    if p_shared_with_organization_id is null then
      perform pg_advisory_xact_lock(hashtextextended(v_user::text || ':' || coalesce(p_related_id::text,''),0));
    end if;
    select c.id into v_existing
    from public.chat_conversations c
    where c.type='direct' and c.organization_id=v_org and c.deleted_at is null
      and exists(select 1 from public.chat_conversation_members m where m.conversation_id=c.id and m.user_id=v_user and m.deleted_at is null)
      and exists(select 1 from public.chat_conversation_members m where m.conversation_id=c.id and m.user_id=coalesce(p_related_id,v_user) and m.deleted_at is null)
      and (select count(*) from public.chat_conversation_members m where m.conversation_id=c.id and m.deleted_at is null)=2
    limit 1;
    if v_existing is not null then
      select * into v_row from public.chat_conversations where id=v_existing;
      return v_row;
    end if;
  end if;

  if p_type='shared_company' then
    if p_shared_with_organization_id is null or p_shared_with_organization_id=v_org then raise exception 'سازمان مقصد برای مکالمه مشترک الزامی است'; end if;
    if not public.orgs_are_connected(v_org,p_shared_with_organization_id) then raise exception 'بین دو سازمان ارتباط پذیرفته‌شده وجود ندارد'; end if;
    if public.user_role()::text not in ('owner','admin') then raise exception 'ایجاد کانال مشترک فقط برای مالک یا مدیر مجاز است'; end if;
  end if;

  insert into public.chat_conversations(
    organization_id,type,title,related_type,related_id,shared_with_organization_id,org_connection_id,created_by
  ) values (
    v_org,p_type,nullif(trim(p_title),''),
    nullif(trim(p_related_type),''),
    p_related_id,p_shared_with_organization_id,p_org_connection_id,v_user
  ) returning * into v_row;

  insert into public.chat_conversation_members(
    organization_id,conversation_id,user_id,role
  ) values (v_org,v_row.id,v_user,'owner');

  return v_row;
end;
$$;

create or replace function public.chat_add_member(
  p_conversation_id uuid,
  p_user_id uuid,
  p_role text default 'member'
)
returns public.chat_conversation_members
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_current uuid:=auth.uid();
  v_conv public.chat_conversations;
  v_target public.profiles;
  v_row public.chat_conversation_members;
  v_allowed_org uuid;
begin
  if v_current is null or not public.chat_can_manage(p_conversation_id) then raise exception 'اجازه افزودن عضو را ندارید'; end if;
  if p_role not in ('admin','member','guest') then raise exception 'نقش عضو نامعتبر است'; end if;

  select * into v_conv from public.chat_conversations where id=p_conversation_id and deleted_at is null;
  if not found then raise exception 'مکالمه پیدا نشد'; end if;
  select * into v_target from public.profiles where id=p_user_id and is_active=true;
  if not found then raise exception 'کاربر مقصد فعال نیست'; end if;

  v_allowed_org := v_conv.organization_id;
  if v_target.role::text='client' and v_conv.type in ('group','company_channel') then
    raise exception 'نقش صاحب کالا عضو کانال داخلی نیست';
  end if;

  if v_target.organization_id <> v_allowed_org then
    if v_conv.type<>'shared_company'
       or v_conv.shared_with_organization_id <> v_target.organization_id
       or not public.orgs_are_connected(v_conv.organization_id,v_target.organization_id) then
      raise exception 'کاربر مقصد عضو سازمان مجاز برای این مکالمه نیست';
    end if;
  end if;

  insert into public.chat_conversation_members(organization_id,conversation_id,user_id,role,left_at,deleted_at)
  values(v_target.organization_id,p_conversation_id,p_user_id,p_role,null,null)
  on conflict(conversation_id,user_id) where deleted_at is null
  do update set role=excluded.role,left_at=null,updated_at=now()
  returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.chat_insert_message(
  p_conversation_id uuid,
  p_client_uuid uuid,
  p_message_type text,
  p_body text default null,
  p_reply_to_message_id uuid default null,
  p_forwarded_from_message_id uuid default null,
  p_thread_root_message_id uuid default null
)
returns public.chat_messages
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_user uuid:=auth.uid();
  v_org uuid:=public.user_org_id();
  v_row public.chat_messages;
  v_conv_org uuid;
begin
  if v_user is null or not public.chat_user_is_member(p_conversation_id) then raise exception 'عضویت در مکالمه الزامی است'; end if;
  if p_client_uuid is null then raise exception 'شناسه یکتای پیام الزامی است'; end if;
  if p_message_type not in ('text','system','file','voice') then raise exception 'نوع پیام نامعتبر است'; end if;
  if length(coalesce(p_body,''))>10000 then raise exception 'متن پیام طولانی‌تر از حد مجاز است'; end if;

  select organization_id into v_conv_org from public.chat_conversations where id=p_conversation_id and deleted_at is null;
  if v_conv_org is null then raise exception 'مکالمه پیدا نشد'; end if;

  if p_reply_to_message_id is not null and not exists(
    select 1 from public.chat_messages m where m.id=p_reply_to_message_id and m.conversation_id=p_conversation_id and m.deleted_at is null
  ) then raise exception 'پیام مرجع پیدا نشد'; end if;
  if p_forwarded_from_message_id is not null and not exists(
    select 1 from public.chat_messages m where m.id=p_forwarded_from_message_id and public.chat_user_is_member(m.conversation_id) and m.deleted_at is null
  ) then raise exception 'پیام ارجاع‌شده در دسترس نیست'; end if;
  if p_thread_root_message_id is not null and not exists(
    select 1 from public.chat_messages m where m.id=p_thread_root_message_id and m.conversation_id=p_conversation_id and m.deleted_at is null
  ) then raise exception 'رشته گفتگو پیدا نشد'; end if;

  select * into v_row from public.chat_messages where conversation_id=p_conversation_id and client_uuid=p_client_uuid;
  if found then return v_row; end if;

  insert into public.chat_messages(
    organization_id,conversation_id,sender_id,client_uuid,message_type,body,reply_to_message_id,forwarded_from_message_id,thread_root_message_id
  ) values(
    v_conv_org,p_conversation_id,v_user,p_client_uuid,p_message_type,nullif(p_body,''),p_reply_to_message_id,p_forwarded_from_message_id,p_thread_root_message_id
  ) returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.chat_mark_read(p_conversation_id uuid, p_message_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
begin
  if not public.chat_user_is_member(p_conversation_id) then raise exception 'عضویت در مکالمه الزامی است'; end if;
  if not exists(select 1 from public.chat_messages m where m.id=p_message_id and m.conversation_id=p_conversation_id and m.deleted_at is null) then raise exception 'پیام نامعتبر است'; end if;
  update public.chat_conversation_members
     set last_read_message_id=p_message_id,updated_at=now()
   where conversation_id=p_conversation_id and user_id=auth.uid() and deleted_at is null;
  insert into public.chat_message_receipts(organization_id,message_id,user_id,status,delivered_at,read_at)
  select m.organization_id,m.id,auth.uid(),'read',coalesce(r.delivered_at,now()),now()
  from public.chat_messages m
  left join public.chat_message_receipts r on r.message_id=m.id and r.user_id=auth.uid()
  where m.id=p_message_id
  on conflict(message_id,user_id) do update
    set status='read',read_at=now(),delivered_at=coalesce(public.chat_message_receipts.delivered_at,now()),updated_at=now();
end;
$$;

create or replace function public.chat_mark_delivered(p_message_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
begin
  if not exists(
    select 1 from public.chat_messages m
    where m.id=p_message_id and m.deleted_at is null and public.chat_user_is_member(m.conversation_id)
  ) then raise exception 'پیام نامعتبر است'; end if;

  insert into public.chat_message_receipts(organization_id,message_id,user_id,status,delivered_at)
  select m.organization_id,m.id,auth.uid(),'delivered',now()
  from public.chat_messages m where m.id=p_message_id
  on conflict(message_id,user_id) do update
    set status=case when public.chat_message_receipts.status='read' then 'read' else 'delivered' end,
        delivered_at=coalesce(public.chat_message_receipts.delivered_at,now()),
        updated_at=now();
end;
$$;

create or replace function public.chat_delete_message_for_me(p_message_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare v_org uuid;
begin
  select organization_id into v_org from public.chat_messages where id=p_message_id and deleted_at is null;
  if v_org is null or not public.chat_user_is_member((select conversation_id from public.chat_messages where id=p_message_id)) then raise exception 'پیام در دسترس نیست'; end if;
  insert into public.chat_message_user_states(organization_id,message_id,user_id,deleted_at)
  values(v_org,p_message_id,auth.uid(),now())
  on conflict(message_id,user_id) do update set deleted_at=now(),updated_at=now();
end;
$$;

create or replace function public.chat_delete_message_for_all(p_message_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare v_created timestamptz; v_conv uuid;
begin
  select created_at,conversation_id into v_created,v_conv from public.chat_messages where id=p_message_id and deleted_at is null;
  if v_created is null then raise exception 'پیام در دسترس نیست'; end if;
  if not exists(select 1 from public.chat_messages where id=p_message_id and (sender_id=auth.uid() or public.chat_can_manage(v_conv))) then
    raise exception 'اجازه حذف برای همه را ندارید';
  end if;
  if v_created < now() - interval '15 minutes' then raise exception 'مهلت حذف برای همه سپری شده است'; end if;

  perform set_config('customs_os.chat_delete_for_all','1',true);
  update public.chat_messages
     set deleted_at=now(),deleted_for_all_at=now(),updated_at=now()
   where id=p_message_id and deleted_at is null;
end;
$$;

create or replace function public.chat_toggle_star(p_message_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare v_org uuid; v_starred boolean;
begin
  select organization_id into v_org from public.chat_messages where id=p_message_id and deleted_at is null;
  if v_org is null or not public.chat_user_is_member((select conversation_id from public.chat_messages where id=p_message_id)) then raise exception 'پیام در دسترس نیست'; end if;
  if exists(select 1 from public.chat_message_user_states where message_id=p_message_id and user_id=auth.uid() and starred_at is not null) then
    update public.chat_message_user_states set starred_at=null,updated_at=now() where message_id=p_message_id and user_id=auth.uid();
    v_starred:=false;
  else
    insert into public.chat_message_user_states(organization_id,message_id,user_id,starred_at) values(v_org,p_message_id,auth.uid(),now())
    on conflict(message_id,user_id) do update set starred_at=now(),updated_at=now();
    v_starred:=true;
  end if;
  return v_starred;
end;
$$;

create or replace function public.chat_toggle_reaction(p_message_id uuid,p_emoji text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare v_org uuid; v_exists boolean;
begin
  select organization_id into v_org from public.chat_messages where id=p_message_id and deleted_at is null;
  if v_org is null or not public.chat_user_is_member((select conversation_id from public.chat_messages where id=p_message_id)) then raise exception 'پیام در دسترس نیست'; end if;
  select exists(select 1 from public.chat_message_reactions where message_id=p_message_id and user_id=auth.uid() and emoji=p_emoji) into v_exists;
  if v_exists then
    delete from public.chat_message_reactions where message_id=p_message_id and user_id=auth.uid() and emoji=p_emoji;
    return false;
  end if;
  insert into public.chat_message_reactions(organization_id,message_id,user_id,emoji) values(v_org,p_message_id,auth.uid(),p_emoji);
  return true;
end;
$$;

create or replace function public.chat_mark_focus(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare v_org uuid:=public.user_org_id();
begin
  if not public.chat_user_is_member(p_conversation_id) then raise exception 'عضویت در مکالمه الزامی است'; end if;
  insert into public.chat_user_focus(user_id,organization_id,conversation_id,focused_at,updated_at)
  values(auth.uid(),v_org,p_conversation_id,now(),now())
  on conflict(user_id) do update set organization_id=excluded.organization_id,conversation_id=excluded.conversation_id,focused_at=now(),updated_at=now();
end;
$$;

create or replace function public.chat_clear_focus()
returns void
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
begin
  delete from public.chat_user_focus where user_id=auth.uid();
end;
$$;

create or replace function public.chat_register_attachment(
  p_conversation_id uuid,
  p_message_id uuid,
  p_storage_path text,
  p_original_name text,
  p_mime_type text,
  p_size_bytes bigint,
  p_duration_seconds numeric default null,
  p_waveform jsonb default null,
  p_thumbnail_path text default null
)
returns public.chat_attachments
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare v_org uuid; v_row public.chat_attachments;
begin
  if not public.chat_user_is_member(p_conversation_id) then raise exception 'عضویت در مکالمه الزامی است'; end if;
  select organization_id into v_org from public.chat_conversations where id=p_conversation_id and deleted_at is null;
  if v_org is null then raise exception 'مکالمه پیدا نشد'; end if;
  if not exists(select 1 from public.chat_messages where id=p_message_id and conversation_id=p_conversation_id and sender_id=auth.uid() and deleted_at is null) then raise exception 'پیام پیوست نامعتبر است'; end if;
  if p_size_bytes is null or p_size_bytes<=0 or p_size_bytes>52428800 then raise exception 'حجم فایل بیش از حد مجاز است'; end if;
  if p_storage_path !~ ('^quarantine/'||v_org::text||'/'||p_conversation_id::text||'/[0-9a-fA-F-]{36}$') then raise exception 'مسیر فایل نامعتبر است'; end if;
  insert into public.chat_attachments(
    organization_id,conversation_id,message_id,storage_path,original_name,mime_type,size_bytes,duration_seconds,waveform,thumbnail_path,created_by
  ) values(v_org,p_conversation_id,p_message_id,p_storage_path,p_original_name,p_mime_type,p_size_bytes,p_duration_seconds,p_waveform,p_thumbnail_path,auth.uid())
  returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.chat_list_messages(
  p_conversation_id uuid,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null,
  p_limit integer default 50
)
returns setof public.chat_messages
language sql
stable
security definer
set search_path = public, pg_catalog, pg_temp
as $$
  select m.*
  from public.chat_messages m
  where m.conversation_id=p_conversation_id
    and m.deleted_at is null
    and public.chat_user_is_member(p_conversation_id)
    and (
      p_before_created_at is null
      or m.created_at<p_before_created_at
      or (m.created_at=p_before_created_at and m.id<p_before_id)
    )
    and not exists(
      select 1 from public.chat_message_user_states s
      where s.message_id=m.id and s.user_id=auth.uid() and s.deleted_at is not null
    )
  order by m.created_at desc,m.id desc
  limit greatest(1,least(coalesce(p_limit,50),100));
$$;

create or replace function public.chat_first_unread(p_conversation_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_catalog, pg_temp
as $$
  select m.id
  from public.chat_messages m
  left join public.chat_conversation_members me on me.conversation_id=m.conversation_id and me.user_id=auth.uid() and me.deleted_at is null
  left join public.chat_messages lm on lm.id=me.last_read_message_id
  where m.conversation_id=p_conversation_id
    and m.deleted_at is null
    and public.chat_user_is_member(p_conversation_id)
    and not exists(select 1 from public.chat_message_user_states s where s.message_id=m.id and s.user_id=auth.uid() and s.deleted_at is not null)
    and (lm.id is null or m.created_at>lm.created_at or (m.created_at=lm.created_at and m.id>lm.id))
  order by m.created_at asc,m.id asc
  limit 1;
$$;

create or replace function public.chat_unread_count(p_conversation_id uuid)
returns bigint
language sql
stable
security definer
set search_path = public, pg_catalog, pg_temp
as $$
  select count(*)
  from public.chat_messages m
  join public.chat_conversation_members me on me.conversation_id=m.conversation_id and me.user_id=auth.uid() and me.deleted_at is null and me.left_at is null
  left join public.chat_messages lm on lm.id=me.last_read_message_id
  where m.conversation_id=p_conversation_id and m.deleted_at is null
    and public.chat_user_is_member(p_conversation_id)
    and not exists(select 1 from public.chat_message_user_states s where s.message_id=m.id and s.user_id=auth.uid() and s.deleted_at is not null)
    and (lm.id is null or m.created_at>lm.created_at or (m.created_at=lm.created_at and m.id>lm.id));
$$;

create or replace function public.chat_conversation_list(p_limit integer default 100)
returns table(
  conversation_id uuid,
  type text,
  title text,
  updated_at timestamptz,
  last_message_id uuid,
  last_message_body text,
  last_message_created_at timestamptz,
  unread_count bigint,
  muted_until timestamptz
)
language sql
stable
security definer
set search_path = public, pg_catalog, pg_temp
as $$
  select c.id,c.type,c.title,c.updated_at,lm.id,
         case when lm.deleted_at is null then lm.body else null end,
         lm.created_at,
         (
           select public.chat_unread_count(c.id)
         ),
         me.muted_until
  from public.chat_conversations c
  join public.chat_conversation_members me on me.conversation_id=c.id and me.user_id=auth.uid() and me.deleted_at is null and me.left_at is null
  left join lateral (
    select m.* from public.chat_messages m
    where m.conversation_id=c.id and m.deleted_at is null
      and not exists(select 1 from public.chat_message_user_states s where s.message_id=m.id and s.user_id=auth.uid() and s.deleted_at is not null)
    order by m.created_at desc,m.id desc limit 1
  ) lm on true
  where c.deleted_at is null
  order by c.updated_at desc,c.id desc
  limit greatest(1,least(coalesce(p_limit,100),100));
$$;

create or replace function public.chat_search(
  p_query text,
  p_conversation_id uuid default null,
  p_limit integer default 30
)
returns table(kind text,id uuid,conversation_id uuid,title text,snippet text,created_at timestamptz)
language sql
stable
security definer
set search_path = public, pg_catalog, pg_temp
as $$
  with q as (select public.chat_normalize_text(trim(coalesce(p_query,''))) as q),
  msg as (
    select 'message'::text kind,m.id,m.conversation_id,
      coalesce(p.title,'مکالمه') title,
      left(regexp_replace(coalesce(m.body,''),E'\s+',' ','g'),240) snippet,
      m.created_at
    from public.chat_messages m
    join public.chat_conversations p on p.id=m.conversation_id and p.deleted_at is null
    cross join q
    where public.chat_user_is_member(m.conversation_id)
      and m.deleted_at is null
      and (p_conversation_id is null or m.conversation_id=p_conversation_id)
      and q.q <> ''
      and (
        to_tsvector('simple',public.chat_normalize_text(coalesce(m.body,''))) @@ websearch_to_tsquery('simple',q.q)
        or public.chat_normalize_text(coalesce(m.body,'')) % q.q
      )
  ),
  att as (
    select 'file'::text,m.id,a.conversation_id,coalesce(p.title,'مکالمه'),
      a.original_name,a.created_at
    from public.chat_attachments a
    join public.chat_messages m on m.id=a.message_id and m.deleted_at is null
    join public.chat_conversations p on p.id=a.conversation_id and p.deleted_at is null
    cross join q
    where public.chat_user_is_member(a.conversation_id)
      and a.deleted_at is null and a.security_status<>'blocked'
      and (p_conversation_id is null or a.conversation_id=p_conversation_id)
      and public.chat_normalize_text(a.original_name) % q.q
  ),
  people as (
    select distinct on (p.id)
      'person'::text,p.id,m.conversation_id,coalesce(p.full_name,'کاربر'),
      coalesce(p.phone,''),p.created_at
    from public.profiles p
    join public.chat_conversation_members m on m.user_id=p.id and m.deleted_at is null
    cross join q
    where public.chat_user_is_member(m.conversation_id)
      and p.is_active
      and (public.chat_normalize_text(coalesce(p.full_name,'')) % q.q
        or public.chat_normalize_text(coalesce(p.phone,'')) % q.q)
    order by p.id,m.joined_at desc
  )
  select * from (
    select * from msg
    union all select * from att
    union all select * from people
  ) results
  order by created_at desc,id desc
  limit greatest(1,least(coalesce(p_limit,30),100));
$$;

create or replace function public.chat_toggle_pin(p_message_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare v_org uuid; v_conv uuid; v_exists boolean;
begin
  select organization_id,conversation_id into v_org,v_conv from public.chat_messages where id=p_message_id and deleted_at is null;
  if v_org is null or not public.chat_can_manage(v_conv) then raise exception 'اجازه سنجاق پیام را ندارید'; end if;
  select exists(select 1 from public.chat_message_pins where message_id=p_message_id) into v_exists;
  if v_exists then delete from public.chat_message_pins where message_id=p_message_id; return false; end if;
  insert into public.chat_message_pins(organization_id,message_id,pinned_by) values(v_org,p_message_id,auth.uid());
  return true;
end;
$$;

create or replace function public.chat_guard_message_mutation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
begin
  if auth.uid() is not null and new.sender_id<>old.sender_id then raise exception 'فرستنده قابل تغییر نیست'; end if;
  if new.conversation_id<>old.conversation_id or new.organization_id<>old.organization_id or new.client_uuid<>old.client_uuid then
    raise exception 'شناسه‌های پیام قابل تغییر نیستند';
  end if;

  if new.deleted_for_all_at is distinct from old.deleted_for_all_at then
    if current_setting('customs_os.chat_delete_for_all',true) <> '1' then raise exception 'حذف برای همه فقط از مسیر امن مجاز است'; end if;
  end if;

  if new.deleted_at is distinct from old.deleted_at and new.deleted_for_all_at is null then
    raise exception 'حذف پیام فقط با مسیر حذف برای همه مجاز است';
  end if;

  if new.body is distinct from old.body then
    if auth.uid()<>old.sender_id then raise exception 'فقط فرستنده می‌تواند پیام را ویرایش کند'; end if;
    if old.deleted_at is not null then raise exception 'پیام حذف‌شده قابل ویرایش نیست'; end if;
    new.edited_at=now();
  else
    new.edited_at=old.edited_at;
  end if;
  new.updated_at=now();
  return new;
end;
$$;

create or replace function public.chat_sync_delivery_status()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
begin
  update public.chat_messages m
     set delivery_status = case
       when exists(select 1 from public.chat_message_receipts r where r.message_id=NEW.message_id and r.status='read') then 'read'
       when exists(select 1 from public.chat_message_receipts r where r.message_id=NEW.message_id and r.status='delivered') then 'delivered'
       else 'sent' end,
       updated_at=now()
   where m.id=NEW.message_id;
  return NEW;
end;
$$;

create or replace function public.chat_enqueue_message_notifications()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
begin
  if NEW.message_type='system' or NEW.sender_id is null then return NEW; end if;
  insert into public.notification_outbox(
    organization_id,user_id,conversation_id,message_id,tag,title,body,url,payload
  )
  select p.organization_id,m.user_id,NEW.conversation_id,NEW.id,
         'chat-'||NEW.conversation_id::text,
         coalesce(c.title,'پیام جدید'),
         case when np.hide_content then null else left(coalesce(NEW.body,''),180) end,
         '/chat?conversation='||NEW.conversation_id::text,
         jsonb_build_object('conversationId',NEW.conversation_id,'messageId',NEW.id)
  from public.chat_conversation_members m
  join public.profiles p on p.id=m.user_id and p.is_active=true
  join public.chat_conversations c on c.id=NEW.conversation_id
  left join public.notification_preferences np on np.user_id=m.user_id
  where m.conversation_id=NEW.conversation_id
    and m.user_id<>NEW.sender_id
    and m.deleted_at is null
    and m.left_at is null
  on conflict(user_id,message_id) do nothing;
  return NEW;
end;
$$;

create or replace function public.chat_storage_path_allowed(p_name text,p_quarantine boolean)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare parts text[]; v_org uuid; v_conv uuid;
begin
  parts:=string_to_array(p_name,'/');
  if p_quarantine then
    if coalesce(array_length(parts,1),0)<>4 or parts[1]<>'quarantine' then return false; end if;
    begin
      v_org:=parts[2]::uuid;
      v_conv:=parts[3]::uuid;
    exception when others then return false;
    end;
  else
    if coalesce(array_length(parts,1),0)<>3 then return false; end if;
    begin
      v_org:=parts[1]::uuid;
      v_conv:=parts[2]::uuid;
    exception when others then return false;
    end;
  end if;
  if v_org<>public.user_org_id() and not exists(
    select 1 from public.chat_conversations c
    where c.id=v_conv and c.shared_with_organization_id=public.user_org_id()
      and c.type='shared_company' and public.orgs_are_connected(c.organization_id,public.user_org_id())
  ) then return false; end if;
  return public.chat_user_is_member(v_conv);
end;
$$;

revoke all on function public.chat_user_is_member(uuid,uuid) from public,anon;
revoke all on function public.chat_can_manage(uuid) from public,anon;
revoke all on function public.chat_connection_allowed_for_conversation(uuid,uuid) from public,anon;
revoke all on function public.chat_create_conversation(text,text,text,uuid,uuid,uuid) from public,anon;
revoke all on function public.chat_add_member(uuid,uuid,text) from public,anon;
revoke all on function public.chat_insert_message(uuid,uuid,text,text,uuid,uuid,uuid) from public,anon;
revoke all on function public.chat_mark_read(uuid,uuid) from public,anon;
revoke all on function public.chat_mark_delivered(uuid) from public,anon;
revoke all on function public.chat_delete_message_for_me(uuid) from public,anon;
revoke all on function public.chat_delete_message_for_all(uuid) from public,anon;
revoke all on function public.chat_toggle_star(uuid) from public,anon;
revoke all on function public.chat_toggle_reaction(uuid,text) from public,anon;
revoke all on function public.chat_mark_focus(uuid) from public,anon;
revoke all on function public.chat_clear_focus() from public,anon;
revoke all on function public.chat_register_attachment(uuid,uuid,text,text,text,bigint,numeric,jsonb,text) from public,anon;
revoke all on function public.chat_list_messages(uuid,timestamptz,uuid,integer) from public,anon;
revoke all on function public.chat_first_unread(uuid) from public,anon;
revoke all on function public.chat_unread_count(uuid) from public,anon;
revoke all on function public.chat_conversation_list(integer) from public,anon;
revoke all on function public.chat_search(text,uuid,integer) from public,anon;
revoke all on function public.chat_toggle_pin(uuid) from public,anon;
revoke all on function public.chat_storage_path_allowed(text,boolean) from public,anon;

grant execute on function public.chat_user_is_member(uuid,uuid) to authenticated;
grant execute on function public.chat_can_manage(uuid) to authenticated;
grant execute on function public.chat_connection_allowed_for_conversation(uuid,uuid) to authenticated;
grant execute on function public.chat_create_conversation(text,text,text,uuid,uuid,uuid) to authenticated;
grant execute on function public.chat_add_member(uuid,uuid,text) to authenticated;
grant execute on function public.chat_insert_message(uuid,uuid,text,text,uuid,uuid,uuid) to authenticated;
grant execute on function public.chat_mark_read(uuid,uuid) to authenticated;
grant execute on function public.chat_mark_delivered(uuid) to authenticated;
grant execute on function public.chat_delete_message_for_me(uuid) to authenticated;
grant execute on function public.chat_delete_message_for_all(uuid) to authenticated;
grant execute on function public.chat_toggle_star(uuid) to authenticated;
grant execute on function public.chat_toggle_reaction(uuid,text) to authenticated;
grant execute on function public.chat_mark_focus(uuid) to authenticated;
grant execute on function public.chat_clear_focus() to authenticated;
grant execute on function public.chat_register_attachment(uuid,uuid,text,text,text,bigint,numeric,jsonb,text) to authenticated;
grant execute on function public.chat_list_messages(uuid,timestamptz,uuid,integer) to authenticated;
grant execute on function public.chat_first_unread(uuid) to authenticated;
grant execute on function public.chat_unread_count(uuid) to authenticated;
grant execute on function public.chat_conversation_list(integer) to authenticated;
grant execute on function public.chat_search(text,uuid,integer) to authenticated;
grant execute on function public.chat_toggle_pin(uuid) to authenticated;
grant execute on function public.chat_storage_path_allowed(text,boolean) to authenticated;

create or replace function public.touch_chat_updated_at()
returns trigger language plpgsql
set search_path=public,pg_catalog,pg_temp
as $$ begin new.updated_at=now(); return new; end; $$;

alter table public.chat_conversations enable row level security;
alter table public.chat_conversation_members enable row level security;
alter table public.chat_messages enable row level security;
alter table public.chat_message_user_states enable row level security;
alter table public.chat_message_reactions enable row level security;
alter table public.chat_message_mentions enable row level security;
alter table public.chat_message_pins enable row level security;
alter table public.chat_message_receipts enable row level security;
alter table public.chat_attachments enable row level security;
alter table public.file_scans enable row level security;
alter table public.notification_outbox enable row level security;
alter table public.chat_user_focus enable row level security;

drop policy if exists chat_conversations_select on public.chat_conversations;
create policy chat_conversations_select on public.chat_conversations
for select to authenticated
using (deleted_at is null and public.chat_user_is_member(id));

drop policy if exists chat_conversations_insert on public.chat_conversations;
create policy chat_conversations_insert on public.chat_conversations
for insert to authenticated
with check (false);

drop policy if exists chat_conversations_update on public.chat_conversations;
create policy chat_conversations_update on public.chat_conversations
for update to authenticated
using (public.chat_can_manage(id))
with check (public.chat_can_manage(id));

drop policy if exists chat_conversations_delete on public.chat_conversations;
create policy chat_conversations_delete on public.chat_conversations
for delete to authenticated
using (false);

drop policy if exists chat_members_select on public.chat_conversation_members;
create policy chat_members_select on public.chat_conversation_members
for select to authenticated
using (deleted_at is null and public.chat_user_is_member(conversation_id));

drop policy if exists chat_members_insert on public.chat_conversation_members;
create policy chat_members_insert on public.chat_conversation_members
for insert to authenticated
with check (false);

drop policy if exists chat_members_update on public.chat_conversation_members;
create policy chat_members_update on public.chat_conversation_members
for update to authenticated
using (false) with check (false);

drop policy if exists chat_members_delete on public.chat_conversation_members;
create policy chat_members_delete on public.chat_conversation_members
for delete to authenticated
using (false);

drop policy if exists chat_messages_select on public.chat_messages;
create policy chat_messages_select on public.chat_messages
for select to authenticated
using (
  deleted_at is null
  and public.chat_user_is_member(conversation_id)
  and not exists(
    select 1 from public.chat_message_user_states s where s.message_id=id and s.user_id=auth.uid() and s.deleted_at is not null
  )
);

drop policy if exists chat_messages_insert on public.chat_messages;
create policy chat_messages_insert on public.chat_messages
for insert to authenticated
with check (
  sender_id=auth.uid()
  and public.chat_user_is_member(conversation_id)
  and organization_id in (
    select c.organization_id from public.chat_conversations c where c.id=conversation_id and c.deleted_at is null
    union all
    select c.shared_with_organization_id from public.chat_conversations c where c.id=conversation_id and c.type='shared_company'
  )
);

drop policy if exists chat_messages_update on public.chat_messages;
create policy chat_messages_update on public.chat_messages
for update to authenticated
using (sender_id=auth.uid() and public.chat_user_is_member(conversation_id))
with check (sender_id=auth.uid() and public.chat_user_is_member(conversation_id));

drop policy if exists chat_messages_delete on public.chat_messages;
create policy chat_messages_delete on public.chat_messages
for delete to authenticated
using (false);

drop policy if exists chat_states_select on public.chat_message_user_states;
create policy chat_states_select on public.chat_message_user_states
for select to authenticated
using (user_id=auth.uid() and exists(select 1 from public.chat_messages m where m.id=message_id and public.chat_user_is_member(m.conversation_id)));

drop policy if exists chat_states_write on public.chat_message_user_states;
create policy chat_states_write on public.chat_message_user_states
for all to authenticated
using (false) with check (false);

drop policy if exists chat_reactions_select on public.chat_message_reactions;
create policy chat_reactions_select on public.chat_message_reactions
for select to authenticated
using (exists(select 1 from public.chat_messages m where m.id=message_id and public.chat_user_is_member(m.conversation_id)));

drop policy if exists chat_reactions_write on public.chat_message_reactions;
create policy chat_reactions_write on public.chat_message_reactions
for all to authenticated
using (false) with check (false);

drop policy if exists chat_mentions_select on public.chat_message_mentions;
create policy chat_mentions_select on public.chat_message_mentions
for select to authenticated
using (exists(select 1 from public.chat_messages m where m.id=message_id and public.chat_user_is_member(m.conversation_id)));

drop policy if exists chat_mentions_write on public.chat_message_mentions;
create policy chat_mentions_write on public.chat_message_mentions
for all to authenticated
using (false) with check (false);

drop policy if exists chat_pins_select on public.chat_message_pins;
create policy chat_pins_select on public.chat_message_pins
for select to authenticated
using (exists(select 1 from public.chat_messages m where m.id=message_id and public.chat_user_is_member(m.conversation_id)));

drop policy if exists chat_pins_write on public.chat_message_pins;
create policy chat_pins_write on public.chat_message_pins
for all to authenticated
using (false) with check (false);

drop policy if exists chat_receipts_select on public.chat_message_receipts;
create policy chat_receipts_select on public.chat_message_receipts
for select to authenticated
using (exists(select 1 from public.chat_messages m where m.id=message_id and public.chat_user_is_member(m.conversation_id)));

drop policy if exists chat_receipts_write on public.chat_message_receipts;
create policy chat_receipts_write on public.chat_message_receipts
for all to authenticated
using (user_id=auth.uid() and exists(select 1 from public.chat_messages m where m.id=message_id and public.chat_user_is_member(m.conversation_id)))
with check (user_id=auth.uid() and exists(select 1 from public.chat_messages m where m.id=message_id and public.chat_user_is_member(m.conversation_id)));

drop policy if exists chat_attachments_select on public.chat_attachments;
create policy chat_attachments_select on public.chat_attachments
for select to authenticated
using (deleted_at is null and public.chat_user_is_member(conversation_id));

drop policy if exists chat_attachments_write on public.chat_attachments;
create policy chat_attachments_write on public.chat_attachments
for all to authenticated
using (false) with check (false);

drop policy if exists file_scans_select on public.file_scans;
create policy file_scans_select on public.file_scans
for select to authenticated
using (exists(select 1 from public.chat_attachments a where a.id=attachment_id and public.chat_user_is_member(a.conversation_id)));

drop policy if exists file_scans_write on public.file_scans;
create policy file_scans_write on public.file_scans
for all to authenticated using (false) with check (false);

drop policy if exists notification_outbox_none on public.notification_outbox;
create policy notification_outbox_none on public.notification_outbox
for all to authenticated using (false) with check (false);

drop policy if exists chat_focus_select on public.chat_user_focus;
create policy chat_focus_select on public.chat_user_focus
for select to authenticated
using (user_id=auth.uid());
drop policy if exists chat_focus_write on public.chat_user_focus;
create policy chat_focus_write on public.chat_user_focus
for all to authenticated
using (user_id=auth.uid())
with check (user_id=auth.uid() and organization_id=(select public.user_org_id()));

revoke all on public.notification_outbox from anon,authenticated;
revoke all on public.chat_user_focus from anon;
grant select on public.chat_conversations,public.chat_conversation_members,public.chat_messages,
  public.chat_message_user_states,public.chat_message_reactions,public.chat_message_mentions,
  public.chat_message_pins,public.chat_message_receipts,public.chat_attachments,public.file_scans
  to authenticated;
grant select,insert,update,delete on public.chat_user_focus to authenticated;

drop trigger if exists trg_chat_conversations_guest on public.chat_conversations;
create trigger trg_chat_conversations_guest before insert or update or delete on public.chat_conversations for each row execute function public.block_audit_guest_writes();
drop trigger if exists trg_chat_members_guest on public.chat_conversation_members;
create trigger trg_chat_members_guest before insert or update or delete on public.chat_conversation_members for each row execute function public.block_audit_guest_writes();
drop trigger if exists trg_chat_messages_guest on public.chat_messages;
create trigger trg_chat_messages_guest before insert or update or delete on public.chat_messages for each row execute function public.block_audit_guest_writes();
drop trigger if exists trg_chat_states_guest on public.chat_message_user_states;
create trigger trg_chat_states_guest before insert or update or delete on public.chat_message_user_states for each row execute function public.block_audit_guest_writes();
drop trigger if exists trg_chat_reactions_guest on public.chat_message_reactions;
create trigger trg_chat_reactions_guest before insert or update or delete on public.chat_message_reactions for each row execute function public.block_audit_guest_writes();
drop trigger if exists trg_chat_mentions_guest on public.chat_message_mentions;
create trigger trg_chat_mentions_guest before insert or update or delete on public.chat_message_mentions for each row execute function public.block_audit_guest_writes();
drop trigger if exists trg_chat_pins_guest on public.chat_message_pins;
create trigger trg_chat_pins_guest before insert or update or delete on public.chat_message_pins for each row execute function public.block_audit_guest_writes();
drop trigger if exists trg_chat_receipts_guest on public.chat_message_receipts;
create trigger trg_chat_receipts_guest before insert or update or delete on public.chat_message_receipts for each row execute function public.block_audit_guest_writes();
drop trigger if exists trg_chat_attachments_guest on public.chat_attachments;
create trigger trg_chat_attachments_guest before insert or update or delete on public.chat_attachments for each row execute function public.block_audit_guest_writes();
drop trigger if exists trg_file_scans_guest on public.file_scans;
create trigger trg_file_scans_guest before insert or update or delete on public.file_scans for each row execute function public.block_audit_guest_writes();
drop trigger if exists trg_notification_outbox_guest on public.notification_outbox;
create trigger trg_notification_outbox_guest before insert or update or delete on public.notification_outbox for each row execute function public.block_audit_guest_writes();
drop trigger if exists trg_chat_focus_guest on public.chat_user_focus;
create trigger trg_chat_focus_guest before insert or update or delete on public.chat_user_focus for each row execute function public.block_audit_guest_writes();

drop trigger if exists trg_chat_conversations_touch on public.chat_conversations;
create trigger trg_chat_conversations_touch before update on public.chat_conversations for each row execute function public.touch_chat_updated_at();
drop trigger if exists trg_chat_members_touch on public.chat_conversation_members;
create trigger trg_chat_members_touch before update on public.chat_conversation_members for each row execute function public.touch_chat_updated_at();
drop trigger if exists trg_chat_messages_mutation on public.chat_messages;
create trigger trg_chat_messages_mutation before update on public.chat_messages for each row execute function public.chat_guard_message_mutation();
drop trigger if exists trg_chat_receipts_status on public.chat_message_receipts;
create trigger trg_chat_receipts_status after insert or update on public.chat_message_receipts for each row execute function public.chat_sync_delivery_status();
drop trigger if exists trg_chat_message_outbox on public.chat_messages;
create trigger trg_chat_message_outbox after insert on public.chat_messages for each row execute function public.chat_enqueue_message_notifications();
drop trigger if exists trg_chat_messages_audit on public.chat_messages;
create trigger trg_chat_messages_audit after update on public.chat_messages for each row execute function public.record_audit_event();

insert into storage.buckets(id,name,public,file_size_limit)
values('chat-files','chat-files',false,52428800)
on conflict(id) do update set public=false,file_size_limit=52428800;

drop policy if exists chat_files_insert on storage.objects;
create policy chat_files_insert on storage.objects
for insert to authenticated
with check (
  bucket_id='chat-files'
  and public.chat_storage_path_allowed(name,true)
);
drop policy if exists chat_files_select on storage.objects;
create policy chat_files_select on storage.objects
for select to authenticated
using (
  bucket_id='chat-files'
  and public.chat_storage_path_allowed(name,false)
);
drop policy if exists chat_files_update on storage.objects;
create policy chat_files_update on storage.objects
for update to authenticated
using (false) with check (false);
drop policy if exists chat_files_delete on storage.objects;
create policy chat_files_delete on storage.objects
for delete to authenticated
using (false);

comment on table public.chat_conversations is 'Conversation visibility is membership based; cross-organization shared conversations require an accepted org_connections row.';
comment on table public.chat_attachments is 'Files remain in quarantine paths until security scan marks them clean and the service moves them into released org/conversation/uuid paths.';
comment on table public.notification_outbox is 'Server-owned idempotent notification queue; never writable by browser clients.';
