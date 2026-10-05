create or replace function public.enqueue_chat_attachment_scan()
returns trigger language plpgsql security definer set search_path=public,pg_catalog as $$
begin
 if tg_op='UPDATE' and coalesce(old.storage_path,'')=coalesce(new.storage_path,'') and coalesce(old.original_name,'')=coalesce(new.original_name,'') and coalesce(old.mime_type,'')=coalesce(new.mime_type,'') and coalesce(old.size_bytes,0)=coalesce(new.size_bytes,0) then return new; end if;
 new.security_status:='scanning';new.security_checked_at:=null;new.security_error:=null;
 if not exists(select 1 from public.file_scans where attachment_id=new.id and status='scanning') then insert into public.file_scans(organization_id,attachment_id,status) values(new.organization_id,new.id,'scanning');end if;
 return new;
end $$;
drop trigger if exists trg_chat_attachment_scan on public.chat_attachments;
create trigger trg_chat_attachment_scan before insert or update of storage_path,original_name,mime_type,size_bytes on public.chat_attachments for each row execute function public.enqueue_chat_attachment_scan();
revoke execute on function public.enqueue_chat_attachment_scan() from public,anon,authenticated;
