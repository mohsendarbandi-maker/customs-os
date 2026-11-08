-- Shipment-level workflow history. Document-level report UI is intentionally retired.
create table if not exists public.file_manager_shipment_reports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  shipment_id uuid not null references public.shipments(id) on delete restrict,
  status text not null default 'in_review'
    check (status in ('received','in_review','action_required','completed','blocked','archived')),
  stage text not null default '',
  report text not null check (char_length(btrim(report)) between 1 and 4000),
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  actor_name text not null default 'کارمند',
  created_at timestamptz not null default now()
);
create index if not exists file_manager_shipment_reports_shipment_created_idx
  on public.file_manager_shipment_reports (organization_id, shipment_id, created_at desc);
alter table public.file_manager_shipment_reports enable row level security;
revoke all on public.file_manager_shipment_reports from anon, authenticated;
grant select, insert on public.file_manager_shipment_reports to authenticated;
drop policy if exists file_manager_shipment_reports_select on public.file_manager_shipment_reports;
create policy file_manager_shipment_reports_select
on public.file_manager_shipment_reports for select to authenticated
using (
  organization_id = public.user_org_id()
  and exists (select 1 from public.shipments s
    where s.id = file_manager_shipment_reports.shipment_id
      and s.organization_id = file_manager_shipment_reports.organization_id)
);
drop policy if exists file_manager_shipment_reports_insert on public.file_manager_shipment_reports;
create policy file_manager_shipment_reports_insert
on public.file_manager_shipment_reports for insert to authenticated
with check (
  organization_id = public.user_org_id()
  and created_by = auth.uid()
  and (select public.user_role())::text = any(array['owner','admin','broker','accountant','warehouse'])
  and exists (select 1 from public.shipments s
    where s.id = file_manager_shipment_reports.shipment_id
      and s.organization_id = file_manager_shipment_reports.organization_id)
);
create or replace function public.set_file_manager_shipment_report_actor()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  new.created_by := auth.uid();
  new.created_at := now();
  select p.full_name into new.actor_name
    from public.profiles p
   where p.id = auth.uid()
     and p.organization_id = new.organization_id;
  if new.actor_name is null or btrim(new.actor_name) = '' then
    new.actor_name := 'کارمند';
  end if;
  return new;
end;
$$;
revoke all on function public.set_file_manager_shipment_report_actor() from public, anon, authenticated;
drop trigger if exists set_file_manager_shipment_report_actor on public.file_manager_shipment_reports;
create trigger set_file_manager_shipment_report_actor
before insert on public.file_manager_shipment_reports
for each row execute function public.set_file_manager_shipment_report_actor();
