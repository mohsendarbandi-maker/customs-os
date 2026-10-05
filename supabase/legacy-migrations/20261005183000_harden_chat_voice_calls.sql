-- Migration: harden_chat_voice_calls
-- Harden live voice call state transitions and indexes.

alter table public.chat_voice_calls
  drop constraint if exists chat_voice_calls_status_check;

alter table public.chat_voice_calls
  add constraint chat_voice_calls_status_check
  check (status in ('ringing','accepted','active','rejected','cancelled','ended','missed'));

create index if not exists chat_voice_calls_callee_status_idx
  on public.chat_voice_calls (callee_id, status, created_at desc);

create index if not exists chat_voice_calls_pair_status_idx
  on public.chat_voice_calls (caller_id, callee_id, status, created_at desc);

drop policy if exists "chat_voice_calls_insert" on public.chat_voice_calls;

create or replace function public.protect_chat_voice_call_identity()
returns trigger
language plpgsql
set search_path to public, pg_catalog, pg_temp
as $function$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'احراز هویت تماس الزامی است';
  end if;

  if new.caller_id is distinct from old.caller_id
     or new.callee_id is distinct from old.callee_id
     or new.organization_id is distinct from old.organization_id
     or new.conversation_id is distinct from old.conversation_id then
    raise exception 'اطلاعات طرفین تماس قابل تغییر نیست';
  end if;

  new.updated_at := now();

  if new.status is distinct from old.status then
    if old.status = 'ringing' and new.status = 'accepted' then
      if v_user <> old.callee_id then
        raise exception 'فقط گیرنده می‌تواند تماس را پاسخ دهد';
      end if;
    elsif old.status = 'ringing' and new.status = 'rejected' then
      if v_user <> old.callee_id then
        raise exception 'فقط گیرنده می‌تواند تماس را رد کند';
      end if;
    elsif old.status = 'ringing' and new.status = 'cancelled' then
      if v_user <> old.caller_id then
        raise exception 'فقط تماس‌گیرنده می‌تواند تماس را لغو کند';
      end if;
    elsif old.status = 'ringing' and new.status = 'missed' then
      if v_user <> old.caller_id and v_user <> old.callee_id then
        raise exception 'بازیگر تماس معتبر نیست';
      end if;
    elsif old.status = 'accepted' and new.status = 'active' then
      if v_user <> old.caller_id and v_user <> old.callee_id then
        raise exception 'بازیگر تماس معتبر نیست';
      end if;
    elsif old.status in ('ringing','accepted','active') and new.status = 'ended' then
      if v_user <> old.caller_id and v_user <> old.callee_id then
        raise exception 'بازیگر تماس معتبر نیست';
      end if;
    elsif old.status in ('rejected','cancelled','ended','missed') then
      raise exception 'این تماس قبلاً پایان یافته است';
    else
      raise exception 'تغییر وضعیت تماس مجاز نیست';
    end if;
  end if;

  if new.status in ('accepted','active') and old.status = 'ringing' then
    new.answered_at := coalesce(new.answered_at, now());
  end if;

  if new.status in ('rejected','cancelled','ended','missed') and new.ended_at is null then
    new.ended_at := now();
  end if;

  return new;
end;
$function$;

revoke execute on function public.start_chat_voice_call(uuid, uuid, uuid) from public, anon;
grant execute on function public.start_chat_voice_call(uuid, uuid, uuid) to authenticated;
