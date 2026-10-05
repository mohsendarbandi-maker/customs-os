-- Phase 3.6: maritime tracking and vessel identity reconciliation.
-- This migration mirrors the live Supabase schema so a fresh database and the live project stay aligned.

ALTER TABLE public.vessels
  ADD COLUMN IF NOT EXISTS imo_number varchar(20),
  ADD COLUMN IF NOT EXISTS flag_code char(2);

ALTER TABLE public.shipments
  ADD COLUMN IF NOT EXISTS current_status text NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS current_location text,
  ADD COLUMN IF NOT EXISTS eta_destination timestamptz,
  ADD COLUMN IF NOT EXISTS etd_origin timestamptz,
  ADD COLUMN IF NOT EXISTS actual_departure_at timestamptz,
  ADD COLUMN IF NOT EXISTS actual_arrival_at timestamptz,
  ADD COLUMN IF NOT EXISTS actual_loading_start_at timestamptz,
  ADD COLUMN IF NOT EXISTS actual_loading_end_at timestamptz,
  ADD COLUMN IF NOT EXISTS actual_discharge_start_at timestamptz,
  ADD COLUMN IF NOT EXISTS actual_discharge_end_at timestamptz;

CREATE TABLE IF NOT EXISTS public.shipment_tracking_events (
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

ALTER TABLE public.shipment_tracking_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS shipment_tracking_events_select ON public.shipment_tracking_events;
DROP POLICY IF EXISTS shipment_tracking_events_insert ON public.shipment_tracking_events;
DROP POLICY IF EXISTS shipment_tracking_events_update ON public.shipment_tracking_events;
CREATE POLICY shipment_tracking_events_select ON public.shipment_tracking_events FOR SELECT TO authenticated USING (organization_id=public.user_org_id());
CREATE POLICY shipment_tracking_events_insert ON public.shipment_tracking_events FOR INSERT TO authenticated WITH CHECK (organization_id=public.user_org_id() AND public.user_role() IN ('owner','admin','broker'));
CREATE POLICY shipment_tracking_events_update ON public.shipment_tracking_events FOR UPDATE TO authenticated USING (organization_id=public.user_org_id() AND public.user_role() IN ('owner','admin','broker')) WITH CHECK (organization_id=public.user_org_id());
GRANT SELECT,INSERT,UPDATE ON public.shipment_tracking_events TO authenticated;

CREATE UNIQUE INDEX IF NOT EXISTS uq_shipments_bl_line_year
  ON public.shipments(organization_id,lower(trim(shipping_line)),lower(trim(bill_of_lading_no)),bill_of_lading_year)
  WHERE bill_of_lading_no IS NOT NULL AND trim(bill_of_lading_no)<>'';
CREATE INDEX IF NOT EXISTS idx_shipments_bl ON public.shipments(organization_id,bill_of_lading_no,bill_of_lading_year);
CREATE INDEX IF NOT EXISTS idx_shipment_tracking_events_shipment_time ON public.shipment_tracking_events(shipment_id,event_time desc);

CREATE OR REPLACE FUNCTION public.set_shipment_tracking_status(
  p_shipment_id uuid, p_status text, p_location text DEFAULT NULL,
  p_event_time timestamptz DEFAULT now(), p_time_type text DEFAULT 'actual',
  p_notes text DEFAULT NULL, p_source text DEFAULT 'manual'
) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE v_org uuid; v_event_code text; v_event_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  v_org:=public.user_org_id();
  IF v_org IS NULL OR public.user_role() NOT IN ('owner','admin','broker') THEN RAISE EXCEPTION 'Insufficient access'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.shipments WHERE id=p_shipment_id AND organization_id=v_org) THEN RAISE EXCEPTION 'Shipment not found or access denied'; END IF;
  IF p_status NOT IN ('draft','booking_confirmed','loading','loaded','departed','in_transit','approaching_destination','anchorage','berthing','discharging','discharged','completed','delayed','cancelled') THEN RAISE EXCEPTION 'Invalid shipment status'; END IF;
  IF p_time_type NOT IN ('estimated','requested','planned','actual') THEN RAISE EXCEPTION 'Invalid time type'; END IF;
  v_event_code:=CASE p_status
    WHEN 'loading' THEN 'loading_start' WHEN 'loaded' THEN 'loading_complete' WHEN 'departed' THEN 'departed'
    WHEN 'in_transit' THEN 'in_transit' WHEN 'approaching_destination' THEN 'approaching_destination'
    WHEN 'anchorage' THEN 'anchorage_arrived' WHEN 'berthing' THEN 'berthing'
    WHEN 'discharging' THEN 'discharge_start' WHEN 'discharged' THEN 'discharge_complete'
    WHEN 'completed' THEN 'completed' WHEN 'delayed' THEN 'delayed' WHEN 'cancelled' THEN 'cancelled'
    WHEN 'booking_confirmed' THEN 'booking_confirmed' ELSE 'draft' END;
  UPDATE public.shipments SET
    current_status=p_status,current_location=nullif(trim(p_location),''),
    actual_loading_start_at=CASE WHEN p_status='loading' AND p_time_type='actual' THEN p_event_time ELSE actual_loading_start_at END,
    actual_loading_end_at=CASE WHEN p_status='loaded' AND p_time_type='actual' THEN p_event_time ELSE actual_loading_end_at END,
    actual_departure_at=CASE WHEN p_status='departed' AND p_time_type='actual' THEN p_event_time ELSE actual_departure_at END,
    actual_arrival_at=CASE WHEN p_status IN ('anchorage','berthing','discharging','discharged','completed') AND p_time_type='actual' THEN p_event_time ELSE actual_arrival_at END,
    actual_discharge_start_at=CASE WHEN p_status='discharging' AND p_time_type='actual' THEN p_event_time ELSE actual_discharge_start_at END,
    actual_discharge_end_at=CASE WHEN p_status IN ('discharged','completed') AND p_time_type='actual' THEN p_event_time ELSE actual_discharge_end_at END,
    updated_at=now()
  WHERE id=p_shipment_id AND organization_id=v_org;
  INSERT INTO public.shipment_tracking_events(organization_id,shipment_id,event_code,time_type,event_time,location,notes,source,created_by)
  VALUES(v_org,p_shipment_id,v_event_code,p_time_type,p_event_time,nullif(trim(p_location),''),p_notes,p_source,auth.uid()) RETURNING id INTO v_event_id;
  RETURN v_event_id;
END; $$;

REVOKE EXECUTE ON FUNCTION public.set_shipment_tracking_status(uuid,text,text,timestamptz,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_shipment_tracking_status(uuid,text,text,timestamptz,text,text,text) TO authenticated;
