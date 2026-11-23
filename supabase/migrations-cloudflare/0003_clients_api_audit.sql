-- Migration 0003: D1 clients API audit events and tenant-scoped indexes.
-- Additive only. Existing client and operational records remain unchanged.

CREATE TABLE IF NOT EXISTS customs_os_audit_events (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('create', 'update', 'delete')),
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  request_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS customs_os_audit_events_org_created_idx
  ON customs_os_audit_events (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS customs_os_audit_events_entity_idx
  ON customs_os_audit_events (organization_id, entity_type, entity_id, created_at DESC);

CREATE INDEX IF NOT EXISTS clients_org_created_idx
  ON clients (organization_id, created_at DESC, id DESC);

-- Enforce uniqueness within an organization; source export has 7/7 unique non-empty IDs.
CREATE UNIQUE INDEX IF NOT EXISTS clients_org_national_id_unique_idx
  ON clients (organization_id, national_id)
  WHERE national_id IS NOT NULL AND trim(national_id) <> '';
