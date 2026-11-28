-- Migration 0018: organization-scoped shipment tracking history for Cloudflare D1.
-- This preserves the legacy event contract without depending on the former RPC.

CREATE TABLE IF NOT EXISTS shipment_tracking_events (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  shipment_id TEXT NOT NULL,
  event_code TEXT NOT NULL CHECK (event_code IN (
    'draft','booking_confirmed','loading_start','loading_complete','departed','in_transit',
    'approaching_destination','anchorage_arrived','berthing','discharge_start',
    'discharge_complete','completed','delayed','cancelled'
  )),
  event_time TEXT NOT NULL,
  time_type TEXT NOT NULL CHECK (time_type IN ('estimated','requested','planned','actual')),
  location TEXT,
  notes TEXT,
  source TEXT NOT NULL DEFAULT 'Customs OS',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (shipment_id) REFERENCES shipments(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS shipment_tracking_events_org_shipment_time_idx
  ON shipment_tracking_events (organization_id, shipment_id, event_time DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS shipment_tracking_events_org_created_idx
  ON shipment_tracking_events (organization_id, created_at DESC);

