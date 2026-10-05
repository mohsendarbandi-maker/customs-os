-- Ensure active conversation membership is unique for member upserts.
create unique index if not exists chat_conversation_members_active_unique
on public.chat_conversation_members (conversation_id, user_id)
where deleted_at is null;

-- Direct conversations must contain both participants.
create or replace function public.chat_create_conversation(
  p_type text,
  p_title text default null,
  p_related_type text default null,
  p_related_id uuid default null,
  p_shared_with_organization_id uuid default null,
  p_org_connection_id uuid default null,
  p_direct_user_id uuid default null
)
returns public.chat_conversations
language plpgsql
security definer
set search_path to 'public', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_user uuid := auth.uid();
  v_org uuid := public.user_org_id();
  v_row public.chat_conversations;
  v_existing uuid;
begin
  if v_user is null or v_org is null then
    raise exception 'احراز هویت الزامی است';
  end if;

  if p_type not in ('direct','group','company_channel','related','shared_company') then
    raise exception 'نوع مکالمه نامعتبر است';
  end if;

  if p_type='direct' then
    if p_direct_user_id is null then
      raise exception 'کاربر دوم مکالمه مستقیم الزامی است';
    end if;

    if p_direct_user_id = v_user then
      raise exception 'گفتگوی مستقیم با خود مجاز نیست';
    end if;

    if not exists(
      select 1 from public.profiles p
      where p.id=p_direct_user_id
        and p.is_active=true
        and p.organization_id=v_org
    ) then
      raise exception 'کاربر دوم مکالمه مستقیم باید عضو فعال همان سازمان باشد';
    end if;

    perform pg_advisory_xact_lock(
      hashtextextended(
        least(v_user::text,p_direct_user_id::text) || ':' ||
        greatest(v_user::text,p_direct_user_id::text),
        0
      )
    );

    select c.id into v_existing
    from public.chat_conversations c
    where c.type='direct'
      and c.organization_id=v_org
      and c.deleted_at is null
      and exists(
        select 1 from public.chat_conversation_members m
        where m.conversation_id=c.id
          and m.user_id=v_user
          and m.deleted_at is null
          and m.left_at is null
      )
      and exists(
        select 1 from public.chat_conversation_members m
        where m.conversation_id=c.id
          and m.user_id=p_direct_user_id
          and m.deleted_at is null
          and m.left_at is null
      )
      and (
        select count(*)
        from public.chat_conversation_members m
        where m.conversation_id=c.id
          and m.deleted_at is null
          and m.left_at is null
      )=2
    limit 1;

    if v_existing is not null then
      select * into v_row from public.chat_conversations where id=v_existing;
      return v_row;
    end if;
  end if;

  if p_type='shared_company' then
    if p_shared_with_organization_id is null or p_shared_with_organization_id=v_org then
      raise exception 'سازمان مقصد برای مکالمه مشترک الزامی است';
    end if;

    if p_org_connection_id is null or not exists(
      select 1 from public.org_connections c
      where c.id=p_org_connection_id
        and c.source_organization_id=v_org
        and c.target_organization_id=p_shared_with_organization_id
        and c.status='accepted'
        and c.deleted_at is null
    ) then
      raise exception 'ارتباط معتبر برای کانال مشترک پیدا نشد';
    end if;

    if public.user_role()::text not in ('owner','admin') then
      raise exception 'ایجاد کانال مشترک فقط برای مالک یا مدیر مجاز است';
    end if;
  end if;

  insert into public.chat_conversations(
    organization_id,type,title,related_type,related_id,
    shared_with_organization_id,org_connection_id,created_by
  )
  values(
    v_org,p_type,nullif(trim(p_title),''),
    nullif(trim(p_related_type),''),p_related_id,
    p_shared_with_organization_id,p_org_connection_id,v_user
  )
  returning * into v_row;

  insert into public.chat_conversation_members(
    organization_id,conversation_id,user_id,role
  )
  values(v_org,v_row.id,v_user,'owner');

  if p_type='direct' then
    insert into public.chat_conversation_members(
      organization_id,conversation_id,user_id,role
    )
    values(v_org,v_row.id,p_direct_user_id,'member');
  end if;

  return v_row;
end;
$function$;
