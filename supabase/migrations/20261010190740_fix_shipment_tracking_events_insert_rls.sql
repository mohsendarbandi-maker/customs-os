-- Reconcile the applied production migration that hardened inserts into
-- shipment_tracking_events. Safe to run again; does not broaden table access.
begin;
alter table public.shipment_tracking_events enable row level security;
drop policy if exists shipment_tracking_events_insert_org on public.shipment_tracking_events;
create policy shipment_tracking_events_insert_org
on public.shipment_tracking_events
as permissive
for insert
to authenticated
with check (
  organization_id = (select public.user_org_id())
  and (select public.user_role()) = any (
    array['owner'::public.user_role, 'admin'::public.user_role, 'broker'::public.user_role]
  )
  and exists (
    select 1
    from public.shipments s
    where s.id = shipment_tracking_events.shipment_id
      and s.organization_id = shipment_tracking_events.organization_id
  )
);
commit;
