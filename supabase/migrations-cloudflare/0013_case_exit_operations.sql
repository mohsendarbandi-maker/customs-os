-- Migration 0013: case-level cargo exit operations and tenant isolation.
-- Mirrors the legacy upsert_case_exit_operation contract. No operational rows are imported here.

CREATE TABLE IF NOT EXISTS case_exit_operations (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  case_id TEXT NOT NULL UNIQUE,
  exit_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (exit_status IN ('pending','authorized','released','exited','cancelled')),
  exit_permit_no TEXT,
  exit_permit_date TEXT,
  exit_authorized_at TEXT,
  exit_at TEXT,
  vehicle_plate TEXT,
  driver_name TEXT,
  driver_national_id TEXT,
  notes TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS case_exit_operations_org_case_updated_idx
  ON case_exit_operations (organization_id, case_id, updated_at DESC);

CREATE TRIGGER IF NOT EXISTS case_exit_operations_tenant_insert
BEFORE INSERT ON case_exit_operations
WHEN NOT EXISTS (
  SELECT 1 FROM cases c
  WHERE c.id = NEW.case_id AND c.organization_id = NEW.organization_id
)
BEGIN
  SELECT RAISE(ABORT, 'case exit organization mismatch');
END;

CREATE TRIGGER IF NOT EXISTS case_exit_operations_tenant_update
BEFORE UPDATE OF case_id, organization_id ON case_exit_operations
WHEN NOT EXISTS (
  SELECT 1 FROM cases c
  WHERE c.id = NEW.case_id AND c.organization_id = NEW.organization_id
)
BEGIN
  SELECT RAISE(ABORT, 'case exit organization mismatch');
END;
