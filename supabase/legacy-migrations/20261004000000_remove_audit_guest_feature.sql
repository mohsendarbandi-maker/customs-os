-- Customs OS: permanently remove the legacy audit-guest feature from the source-of-truth schema.
-- The live project was already repaired out-of-band; this migration keeps the repository aligned.

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='profiles' and column_name='is_audit_guest'
  ) then
    execute 'alter table public.profiles drop column is_audit_guest';
  end if;
end $$;

drop function if exists public.create_audit_guest_profile();
drop function if exists public.block_audit_guest_writes();
