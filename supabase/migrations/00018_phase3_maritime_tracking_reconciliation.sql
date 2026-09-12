-- Phase 3.6: maritime tracking and vessel identity reconciliation.
-- This migration mirrors the live Supabase schema so a fresh database and the live project stay aligned.

alter table public.vessels
  add column if not exists imo_number varchar(20),
  add column if not exists flag_code char(2);

alter table public.shipments
  add column if not exists current_status text not null default 'draft',
  add column if not exists current_location text,
  add column if not exists eta_destination timestamptz,
  add column if not exists etd_origin timestamptz,
  add column if not exists actual_departure_at timestamptz,
  add column if not exists actual_arrival_at timestamptz,
  add column if not exists actual_loading_start_at timestamptz,
  add column if not exists actual_loading_end_at timestamptz,
  add column if not exists actual_discharge_start_at timestamptz,
  add column if not exists actual_discharge_end_at timestamptz;

create table if not exists public.shipment_tracking_events (
  id uuid primary key default extensions.uuid_generate_v4(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  shipment_id uuid not null references public.shipments(id) on delete cascade,
  event_code text not null,
  time_type text not null default 'actual',
  event_time timestamptz not null default now(),
  location text,
  notes text,
  source text not null default 'manual',
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

alter table public.shipment_tracking_events enable row level security;
drop policy if exists shipment_tracking_events_select on public.shipment_tracking_events;
drop policy if exists shipment_tracking_events_insert on public.shipment_tracking_events;
create policy shipment_tracking_events_select on public.shipment_tracking_events for select to authenticated using (organization_id = public.user_org_id());
create policy shipment_tracking_events_insert on public.shipment_tracking_events for insert to authenticated with check (organization_id = public.user_org_id() and public.user_role() in ('owner','admin','broker'));
grant select, insert on public.shipment_tracking_events to authenticated;

create unique index if not exists uq_shipments_bl_line_year
  on public.shipments (organization_id, lower(trim(shipping_line)), lower(trim(bill_of_lading_no)), bill_of_lading_year)
  where bill_of_lading_no is not null and trim(bill_of_lading_no) <> '';

create index if not exists idx_shipment_tracking_events_shipment_time
  on public.shipment_tracking_events(shipment_id, event_time desc);

create or replace function public.set_shipment_tracking_status(
  p_shipment_id uuid,
  p_status text,
  p_location text default null,
  p_event_time timestamptz default now(),
  p_time_type text default 'actual',
  p_notes text default null,
  p_source text default 'manual'
) returns uuid language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_org uuid; v_event_code text; v_event_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  v_org := public.user_org_id();
  if v_org is null or public.user_role() not in ('owner','admin','broker') then raise exception 'Insufficient access'; end if;
  if not exists (select 1 from public.shipments where id=p_shipment_id and organization_id=v_org) then raise exception 'Shipment not found or access denied'; end if;
  if p_status not in ('draft','booking_confirmed','loading','loaded','departed','in_transit','approaching_destination','anchorage','berthing','discharging','discharged','completed','delayed','cancelled') then raise exception 'Invalid shipment status'; end if;
  if p_time_type not in ('estimated','requested','planned','actual') then raise exception 'Invalid time type'; end if;
  v_event_code := case p_status
    when 'loading' then 'loading_start' when 'loaded' then 'loading_complete' when 'departed' then 'departed'
    when 'in_transit' then 'in_transit' when 'approaching_destination' then 'approaching_destination'
    when 'anchorage' then 'anchorage_arrived' when 'berthing' then 'berthing'
    when 'discharging' then 'discharge_start' when 'discharged' then 'discharge_complete'
    when 'completed' then 'completed' when 'delayed' then 'delayed' when 'cancelled' then 'cancelled'
    when 'booking_confirmed' then 'booking_confirmed' else 'draft' end;
  update public.shipments set
    current_status=p_status,
    current_location=nullif(trim(p_location),''),
    actual_loading_start_at=case when p_status='loading' and p_time_type='actual' then p_event_time else actual_loading_start_at end,
    actual_loading_end_at=case when p_status='loaded' and p_time_type='actual' then p_event_time else actual_loading_end_at end,
    actual_departure_at=case when p_status='departed' and p_time_type='actual' then p_event_time else actual_departure_at end,
    actual_arrival_at=case when p_status in ('anchorage','berthing','discharging','discharged','completed') and p_time_type='actual' then p_event_time else actual_arrival_at end,
    actual_discharge_start_at=case when p_status='discharging' and p_time_type='actual' then p_event_time else actual_discharge_start_at end,
    actual_discharge_end_at=case when p_status in ('discharged','completed') and p_time_type='actual' then p_event_time else actual_discharge_end_at end,
    updated_at=now()
  where id=p_shipment_id and organization_id=v_org;
  insert into public.shipment_tracking_events(organization_id,shipment_id,event_code,time_type,event_time,location,notes,source,created_by)
  values(v_org,p_shipment_id,v_event_code,p_time_type,p_event_time,nullif(trim(p_location),''),p_notes,p_source,auth.uid())
  returning id into v_event_id;
  return v_event_id;
end; $$;

revoke execute on function public.set_shipment_tracking_status(uuid,text,text,timestamptz,text,text,text) from public, anon;
grant execute on function public.set_shipment_tracking_status(uuid,text,text,timestamptz,text,text,text) to authenticated;
