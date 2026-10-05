begin;

alter table public.chat_conversations
  add column if not exists parent_conversation_id uuid
    references public.chat_conversations(id) on delete set null;

alter table public.chat_conversations
  add column if not exists hierarchy_kind text not null default 'regular';

alter table public.chat_conversations
  add column if not exists cargo_owner_id uuid
    references public.clients(id) on delete set null;

alter table public.chat_conversations
  add column if not exists shipment_id uuid
    references public.shipments(id) on delete set null;

alter table public.chat_conversations
  drop constraint if exists chat_conversations_hierarchy_kind_check;

alter table public.chat_conversations
  add constraint chat_conversations_hierarchy_kind_check
  check (hierarchy_kind in ('regular','owner_group','shipment_group'));

create unique index if not exists chat_owner_group_unique
on public.chat_conversations(organization_id,cargo_owner_id,hierarchy_kind)
where hierarchy_kind='owner_group'
  and cargo_owner_id is not null
  and deleted_at is null;

create unique index if not exists chat_shipment_group_unique
on public.chat_conversations(organization_id,shipment_id,hierarchy_kind)
where hierarchy_kind='shipment_group'
  and shipment_id is not null
  and deleted_at is null;

create index if not exists chat_conversations_parent_idx
on public.chat_conversations(parent_conversation_id)
where deleted_at is null;

create index if not exists chat_conversations_shipment_idx
on public.chat_conversations(shipment_id)
where deleted_at is null;

create or replace function public.chat_sync_shipment_hierarchy()
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $function$
declare
  v_user uuid := auth.uid();
  v_org uuid := public.user_org_id();
  v_role text := public.user_role()::text;
  v_client_id uuid;
  v_owner_client_id uuid;
  v_owner_room_id uuid;
  v_shipment_id uuid;
  v_count integer := 0;
begin
  if v_user is null or v_org is null then
    raise exception 'احراز هویت الزامی است';
  end if;

  if v_role='client' then
    select p.client_id into v_client_id
    from public.profiles p
    where p.id=v_user and p.organization_id=v_org and p.is_active=true;

    if v_client_id is null then
      return 0;
    end if;
  end if;

  for v_owner_client_id in
    select c.id
    from public.clients c
    where c.organization_id=v_org
      and (v_role <> 'client' or c.id=v_client_id)
  loop
    insert into public.chat_conversations(
      organization_id,type,title,related_type,related_id,
      cargo_owner_id,hierarchy_kind,created_by
    )
    select
      v_org,'group',c.name,'cargo_owner',c.id,
      c.id,'owner_group',v_user
    from public.clients c
    where c.id=v_owner_client_id
    on conflict do nothing;

    select c.id
    into v_owner_room_id
    from public.chat_conversations c
    where c.organization_id=v_org
      and c.cargo_owner_id=v_owner_client_id
      and c.hierarchy_kind='owner_group'
      and c.deleted_at is null
    limit 1;

    if v_owner_room_id is null then
      continue;
    end if;

    insert into public.chat_conversation_members(
      organization_id,conversation_id,user_id,role,left_at,deleted_at
    )
    values(v_org,v_owner_room_id,v_user,'member',null,null)
    on conflict(conversation_id,user_id) where deleted_at is null
    do update set left_at=null,updated_at=now();

    for v_shipment_id in
      select s.id
      from public.shipments s
      where s.organization_id=v_org
        and s.client_id=v_owner_client_id
    loop
      insert into public.chat_conversations(
        organization_id,type,title,related_type,related_id,
        parent_conversation_id,cargo_owner_id,shipment_id,
        hierarchy_kind,created_by
      )
      select
        v_org,
        'related',
        coalesce(nullif(trim(s.display_name),''),nullif(trim(s.bill_of_lading_no),''),'محموله'),
        'shipment',
        s.id,
        v_owner_room_id,
        v_owner_client_id,
        s.id,
        'shipment_group',
        v_user
      from public.shipments s
      where s.id=v_shipment_id
      on conflict do nothing;

      v_count := v_count + 1;
    end loop;

    insert into public.chat_conversation_members(
      organization_id,conversation_id,user_id,role,left_at,deleted_at
    )
    select
      v_org,c.id,v_user,'member',null,null
    from public.chat_conversations c
    where c.organization_id=v_org
      and c.parent_conversation_id=v_owner_room_id
      and c.hierarchy_kind='shipment_group'
      and c.deleted_at is null
    on conflict(conversation_id,user_id) where deleted_at is null
    do update set left_at=null,updated_at=now();
  end loop;

  return v_count;
end;
$function$;

revoke all on function public.chat_sync_shipment_hierarchy() from public,anon;
grant execute on function public.chat_sync_shipment_hierarchy() to authenticated;

create or replace function public.chat_hierarchy_list(p_limit integer default 200)
returns table(
  conversation_id uuid,
  type text,
  title text,
  updated_at timestamptz,
  last_message_id uuid,
  last_message_body text,
  last_message_created_at timestamptz,
  unread_count bigint,
  muted_until timestamptz,
  hierarchy_kind text,
  parent_conversation_id uuid,
  cargo_owner_id uuid,
  shipment_id uuid,
  shipment_display_name text,
  shipment_bl_number text,
  shipment_status text
)
language plpgsql
volatile
security definer
set search_path = public, pg_catalog, pg_temp
as $function$
begin
  if auth.uid() is null then
    raise exception 'احراز هویت الزامی است';
  end if;

  perform public.chat_sync_shipment_hierarchy();

  return query
  select
    c.id,c.type,c.title,c.updated_at,lm.id,
    case when lm.deleted_at is null then lm.body else null end,
    lm.created_at,
    public.chat_unread_count(c.id),
    me.muted_until,
    c.hierarchy_kind,
    c.parent_conversation_id,
    c.cargo_owner_id,
    c.shipment_id,
    s.display_name::text,
    s.bill_of_lading_no::text,
    s.current_status::text
  from public.chat_conversations c
  join public.chat_conversation_members me
    on me.conversation_id=c.id
   and me.user_id=auth.uid()
   and me.deleted_at is null
   and me.left_at is null
  left join public.shipments s
    on s.id=c.shipment_id
   and s.organization_id=c.organization_id
  left join lateral(
    select m.*
    from public.chat_messages m
    where m.conversation_id=c.id
      and m.deleted_at is null
      and not exists(
        select 1
        from public.chat_message_user_states us
        where us.message_id=m.id
          and us.user_id=auth.uid()
          and us.deleted_at is not null
      )
    order by m.created_at desc,m.id desc
    limit 1
  ) lm on true
  where c.deleted_at is null
    and c.organization_id=public.user_org_id()
    and c.hierarchy_kind in ('owner_group','shipment_group')
  order by
    case when c.hierarchy_kind='owner_group' then 0 else 1 end,
    c.title nulls last,
    c.updated_at desc
  limit greatest(1,least(coalesce(p_limit,200),200));
end;
$function$;

revoke all on function public.chat_hierarchy_list(integer) from public,anon;
grant execute on function public.chat_hierarchy_list(integer) to authenticated;

create or replace function public.chat_edit_message(
  p_message_id uuid,
  p_body text
)
returns public.chat_messages
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $function$
declare
  v_row public.chat_messages;
begin
  if auth.uid() is null then
    raise exception 'احراز هویت الزامی است';
  end if;

  if nullif(trim(coalesce(p_body,'')),'') is null then
    raise exception 'متن پیام خالی است';
  end if;

  select *
  into v_row
  from public.chat_messages
  where id=p_message_id
    and deleted_at is null
    and sender_id=auth.uid();

  if not found then
    raise exception 'پیام برای ویرایش در دسترس نیست';
  end if;

  if v_row.created_at < now() - interval '15 minutes' then
    raise exception 'مهلت ویرایش پیام سپری شده است';
  end if;

  update public.chat_messages
  set body=trim(p_body)
  where id=p_message_id
  returning * into v_row;

  return v_row;
end;
$function$;

revoke all on function public.chat_edit_message(uuid,text) from public,anon;
grant execute on function public.chat_edit_message(uuid,text) to authenticated;

create or replace function public.chat_forward_message(
  p_message_id uuid,
  p_target_conversation_id uuid,
  p_client_uuid uuid
)
returns public.chat_messages
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $function$
declare
  v_source public.chat_messages;
  v_result public.chat_messages;
begin
  select *
  into v_source
  from public.chat_messages
  where id=p_message_id
    and deleted_at is null
    and public.chat_user_is_member(conversation_id);

  if not found then
    raise exception 'پیام مبدا در دسترس نیست';
  end if;

  if not public.chat_user_is_member(p_target_conversation_id) then
    raise exception 'عضویت در گفتگوی مقصد الزامی است';
  end if;

  select *
  into v_result
  from public.chat_insert_message(
    p_target_conversation_id,
    p_client_uuid,
    v_source.message_type,
    v_source.body,
    null,
    p_message_id,
    null
  );

  return v_result;
end;
$function$;

revoke all on function public.chat_forward_message(uuid,uuid,uuid) from public,anon;
grant execute on function public.chat_forward_message(uuid,uuid,uuid) to authenticated;

create or replace function public.chat_share_shipment_update(
  p_conversation_id uuid,
  p_shipment_id uuid,
  p_status text,
  p_note text default null
)
returns public.chat_messages
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $function$
declare
  v_shipment public.shipments;
  v_message public.chat_messages;
  v_body text;
begin
  if not public.chat_user_is_member(p_conversation_id) then
    raise exception 'عضویت در گفتگو الزامی است';
  end if;

  select *
  into v_shipment
  from public.shipments
  where id=p_shipment_id
    and organization_id=public.user_org_id();

  if not found then
    raise exception 'محموله پیدا نشد';
  end if;

  if not exists(
    select 1
    from public.chat_conversations c
    where c.id=p_conversation_id
      and c.shipment_id=p_shipment_id
      and c.hierarchy_kind='shipment_group'
      and c.deleted_at is null
  ) then
    raise exception 'کانال محموله نامعتبر است';
  end if;

  v_body :=
    '📦 به‌روزرسانی محموله' || E'\n' ||
    'وضعیت: ' || coalesce(nullif(trim(p_status),''),'نامشخص') ||
    case
      when nullif(trim(coalesce(p_note,'')),'') is not null
      then E'\n' || 'توضیح: ' || trim(p_note)
      else ''
    end;

  select *
  into v_message
  from public.chat_insert_message(
    p_conversation_id,
    gen_random_uuid(),
    'system',
    v_body,
    null,
    null,
    null
  );

  return v_message;
end;
$function$;

revoke all on function public.chat_share_shipment_update(uuid,uuid,text,text) from public,anon;
grant execute on function public.chat_share_shipment_update(uuid,uuid,text,text) to authenticated;

create or replace function public.chat_broadcast_message()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $function$
begin
  perform realtime.send(
    jsonb_build_object('record',to_jsonb(NEW)),
    case when TG_OP='INSERT' then 'message:new' else 'message:update' end,
    'chat:' || NEW.conversation_id::text,
    true
  );

  return NEW;
end;
$function$;

revoke all on function public.chat_broadcast_message() from public,anon,authenticated;

drop trigger if exists trg_chat_realtime_message_broadcast
on public.chat_messages;

create trigger trg_chat_realtime_message_broadcast
after insert or update
on public.chat_messages
for each row
execute function public.chat_broadcast_message();

create or replace function public.chat_broadcast_reaction()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $function$
declare
  v_conversation_id uuid;
begin
  select m.conversation_id
  into v_conversation_id
  from public.chat_messages m
  where m.id = case when TG_OP='DELETE' then OLD.message_id else NEW.message_id end;

  perform realtime.send(
    jsonb_build_object(
      'record',to_jsonb(case when TG_OP='DELETE' then OLD else NEW end),
      'operation',lower(TG_OP)
    ),
    'reaction:change',
    'chat:' || v_conversation_id::text,
    true
  );

  return case when TG_OP='DELETE' then OLD else NEW end;
end;
$function$;

revoke all on function public.chat_broadcast_reaction() from public,anon,authenticated;

drop trigger if exists trg_chat_realtime_reaction_broadcast
on public.chat_message_reactions;

create trigger trg_chat_realtime_reaction_broadcast
after insert or update or delete
on public.chat_message_reactions
for each row
execute function public.chat_broadcast_reaction();

create or replace function public.chat_broadcast_receipt()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $function$
declare
  v_conversation_id uuid;
begin
  select m.conversation_id
  into v_conversation_id
  from public.chat_messages m
  where m.id=NEW.message_id;

  perform realtime.send(
    jsonb_build_object('record',to_jsonb(NEW)),
    'read',
    'chat:' || v_conversation_id::text,
    true
  );

  return NEW;
end;
$function$;

revoke all on function public.chat_broadcast_receipt() from public,anon,authenticated;

drop trigger if exists trg_chat_realtime_receipt_broadcast
on public.chat_message_receipts;

create trigger trg_chat_realtime_receipt_broadcast
after insert or update
on public.chat_message_receipts
for each row
execute function public.chat_broadcast_receipt();

commit;