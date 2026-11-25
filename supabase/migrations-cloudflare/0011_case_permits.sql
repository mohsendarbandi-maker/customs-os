-- D1 equivalent of the legacy case-level permits table.
-- The exact business columns and status values are retained from the canonical
-- source schema; organization ownership is enforced against the linked case.

CREATE TABLE IF NOT EXISTS permits (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  case_id TEXT NOT NULL,
  permit_type TEXT NOT NULL,
  permit_number TEXT,
  issuing_authority TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected','not_required')),
  issued_at TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS permits_org_case_created_idx
  ON permits (organization_id, case_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS permits_org_status_idx
  ON permits (organization_id, status);

CREATE TRIGGER IF NOT EXISTS permits_tenant_insert
BEFORE INSERT ON permits
WHEN NOT EXISTS (
  SELECT 1 FROM cases c
  WHERE c.id = NEW.case_id AND c.organization_id = NEW.organization_id
)
BEGIN
  SELECT RAISE(ABORT, 'permit case organization mismatch');
END;

CREATE TRIGGER IF NOT EXISTS permits_tenant_update
BEFORE UPDATE OF case_id, organization_id ON permits
WHEN NOT EXISTS (
  SELECT 1 FROM cases c
  WHERE c.id = NEW.case_id AND c.organization_id = NEW.organization_id
)
BEGIN
  SELECT RAISE(ABORT, 'permit case organization mismatch');
END;
