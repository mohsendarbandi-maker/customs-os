begin;

create or replace function public.prepare_chat_attachment_security()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
begin
  if tg_op = 'INSERT' then
    new.security_status := 'scanning';
    new.security_checked_at := null;
    new.security_error := null;
  end if;
  return new;
end
$function$;

create unique index if not exists file_scans_one_scanning_per_attachment
on public.file_scans(attachment_id)
where status = 'scanning';

create or replace function public.enqueue_chat_attachment_scan()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
begin
  if tg_op = 'UPDATE' then
    if new.security_status = 'clean' then
      return new;
    end if;
    if coalesce(old.storage_path,'') = coalesce(new.storage_path,'')
       and coalesce(old.original_name,'') = coalesce(new.original_name,'')
       and coalesce(old.mime_type,'') = coalesce(new.mime_type,'')
       and coalesce(old.size_bytes,0) = coalesce(new.size_bytes,0) then
      return new;
    end if;
    if coalesce(new.storage_path,'') not like 'quarantine/%' then
      return new;
    end if;
  end if;

  insert into public.file_scans(organization_id,attachment_id,status)
  values(new.organization_id,new.id,'scanning')
  on conflict do nothing;
  return new;
end
$function$;

create or replace function public.chat_enqueue_message_notifications()
returns trigger
language plpgsql
security definer
set search_path to 'public','net','vault','pg_catalog','pg_temp'
as $function$
declare v_push_secret text;
begin
  if NEW.message_type='system' or NEW.sender_id is null then return NEW; end if;

  insert into public.notification_outbox(organization_id,user_id,conversation_id,message_id,tag,title,body,url,payload)
  select p.organization_id,m.user_id,NEW.conversation_id,NEW.id,
         'chat-'||NEW.conversation_id::text,
         coalesce(sender.full_name,'پیام جدید'),
         case when np.hide_content then null else left(coalesce(NEW.body,''),180) end,
         '/chat?conversation='||NEW.conversation_id::text,
         jsonb_build_object('conversationId',NEW.conversation_id,'messageId',NEW.id,'senderName',coalesce(sender.full_name,''))
  from public.chat_conversation_members m
  join public.profiles p on p.id=m.user_id and p.is_active=true
  join public.chat_conversations c on c.id=NEW.conversation_id
  left join public.profiles sender on sender.id=NEW.sender_id and sender.is_active=true
  left join public.notification_preferences np on np.user_id=m.user_id
  where m.conversation_id=NEW.conversation_id and m.user_id<>NEW.sender_id
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
  return NEW;
end
$function$;

update public.chat_attachments a
set security_status='clean',
    security_checked_at=coalesce((select max(fs.completed_at) from public.file_scans fs where fs.attachment_id=a.id and fs.status='clean'),now()),
    security_error=null
where a.security_status='scanning'
  and coalesce(a.storage_path,'') not like 'quarantine/%'
  and exists(select 1 from public.file_scans fs where fs.attachment_id=a.id and fs.status='clean');

commit;