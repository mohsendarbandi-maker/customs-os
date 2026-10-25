begin;

-- Stop scheduled content inspection and remove DB triggers that put newly added files into quarantine.
do $$
declare v_job record;
begin
  for v_job in select jobid from cron.job where jobname='scan-chat-files-every-minute'
  loop
    perform cron.unschedule(v_job.jobid);
  end loop;
end
$$;

drop trigger if exists trg_chat_attachment_scan on public.chat_attachments;
drop trigger if exists trg_chat_attachment_security_prepare on public.chat_attachments;

-- Keep the trigger functions inert in case a trigger is recreated accidentally.
create or replace function public.enqueue_chat_attachment_scan()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
begin
  return new;
end
$function$;

create or replace function public.prepare_chat_attachment_security()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
begin
  return new;
end
$function$;

alter table public.chat_attachments
  alter column security_status set default 'clean';

-- Clear queue entries that were waiting for the now-disabled scanner.
delete from public.file_scans where status='scanning';

-- New attachments use the direct organization/conversation/object path (no quarantine prefix).
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
set search_path to 'public','pg_catalog','pg_temp'
as $function$
declare
  v_org uuid;
  v_row public.chat_attachments;
begin
  if not public.chat_user_is_member(p_conversation_id) then
    raise exception 'عضویت در مکالمه الزامی است';
  end if;

  select organization_id into v_org
  from public.chat_conversations
  where id=p_conversation_id and deleted_at is null;

  if v_org is null then
    raise exception 'مکالمه پیدا نشد';
  end if;

  if not exists(
    select 1 from public.chat_messages
    where id=p_message_id
      and conversation_id=p_conversation_id
      and sender_id=auth.uid()
      and deleted_at is null
  ) then
    raise exception 'پیام پیوست نامعتبر است';
  end if;

  if p_size_bytes is null or p_size_bytes<=0 or p_size_bytes>52428800 then
    raise exception 'حجم فایل بیش از حد مجاز است';
  end if;

  if p_storage_path !~ ('^'||v_org::text||'/'||p_conversation_id::text||'/[0-9a-fA-F-]{36}$') then
    raise exception 'مسیر فایل نامعتبر است';
  end if;

  insert into public.chat_attachments(
    organization_id,conversation_id,message_id,storage_path,original_name,mime_type,
    size_bytes,duration_seconds,waveform,thumbnail_path,created_by
  ) values(
    v_org,p_conversation_id,p_message_id,p_storage_path,p_original_name,p_mime_type,
    p_size_bytes,p_duration_seconds,p_waveform,p_thumbnail_path,auth.uid()
  )
  returning * into v_row;

  return v_row;
end
$function$;

-- Permit authenticated members to upload only into the conversation-scoped non-quarantine path.
drop policy if exists chat_files_insert_quarantine on storage.objects;
drop policy if exists chat_files_insert_direct on storage.objects;
create policy chat_files_insert_direct on storage.objects
for insert to authenticated
with check (
  bucket_id='chat-files'
  and public.chat_storage_path_allowed(name,false)
  and owner_id=(select auth.uid())::text
);

commit;
