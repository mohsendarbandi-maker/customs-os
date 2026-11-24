-- Migration 0004: indexes for tenant-scoped read-only case queries.
-- Additive only. Does not change workflow state or imported operational rows.

CREATE INDEX IF NOT EXISTS cases_org_created_idx
  ON cases (organization_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS cases_org_case_number_idx
  ON cases (organization_id, case_number);
CREATE INDEX IF NOT EXISTS shipments_org_case_created_idx
  ON shipments (organization_id, case_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS declarations_org_case_created_idx
  ON customs_declarations (organization_id, case_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS customs_documents_org_case_created_idx
  ON customs_documents (organization_id, case_id, created_at DESC, id DESC);
