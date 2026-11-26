-- D1 parity for the declaration operations checklist and final exit checklist.
-- Additive only; existing operational rows and stage values are preserved.

CREATE TABLE IF NOT EXISTS declaration_checklist_items (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  declaration_id TEXT NOT NULL,
  item_key TEXT NOT NULL,
  item_label TEXT NOT NULL,
  completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0,1)),
  note TEXT,
  note_updated_at TEXT,
  note_updated_by TEXT,
  sort_order INTEGER NOT NULL DEFAULT 100,
  source TEXT NOT NULL DEFAULT 'system'
    CHECK (source IN ('system','manual','learned','legacy')),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (declaration_id) REFERENCES customs_declarations(id) ON DELETE CASCADE,
  UNIQUE (declaration_id, item_key)
);

CREATE INDEX IF NOT EXISTS declaration_checklist_items_declaration_active_idx
  ON declaration_checklist_items(organization_id, declaration_id, is_active, sort_order, created_at);

CREATE TRIGGER IF NOT EXISTS declaration_checklist_items_tenant_insert
BEFORE INSERT ON declaration_checklist_items
WHEN NOT EXISTS (
  SELECT 1 FROM customs_declarations d
  WHERE d.id=NEW.declaration_id AND d.organization_id=NEW.organization_id
)
BEGIN
  SELECT RAISE(ABORT, 'declaration checklist organization mismatch');
END;

CREATE TRIGGER IF NOT EXISTS declaration_checklist_items_tenant_update
BEFORE UPDATE OF declaration_id, organization_id ON declaration_checklist_items
WHEN NOT EXISTS (
  SELECT 1 FROM customs_declarations d
  WHERE d.id=NEW.declaration_id AND d.organization_id=NEW.organization_id
)
BEGIN
  SELECT RAISE(ABORT, 'declaration checklist organization mismatch');
END;

-- The exact three exit items from ExitPage.tsx are intentionally constrained.
CREATE TABLE IF NOT EXISTS declaration_exit_checklist_items (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  declaration_id TEXT NOT NULL,
  item_key TEXT NOT NULL CHECK (item_key IN (
    'warehouse_invoice_initial',
    'warehouse_invoice_supplement',
    'transport_power_of_attorney'
  )),
  completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0,1)),
  completed_at TEXT,
  completed_by TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (declaration_id) REFERENCES customs_declarations(id) ON DELETE CASCADE,
  UNIQUE (declaration_id, item_key)
);

CREATE INDEX IF NOT EXISTS declaration_exit_checklist_items_org_declaration_idx
  ON declaration_exit_checklist_items(organization_id, declaration_id, item_key);

CREATE TRIGGER IF NOT EXISTS declaration_exit_checklist_items_tenant_insert
BEFORE INSERT ON declaration_exit_checklist_items
WHEN NOT EXISTS (
  SELECT 1 FROM customs_declarations d
  WHERE d.id=NEW.declaration_id AND d.organization_id=NEW.organization_id
)
BEGIN
  SELECT RAISE(ABORT, 'declaration exit checklist organization mismatch');
END;

CREATE TRIGGER IF NOT EXISTS declaration_exit_checklist_items_tenant_update
BEFORE UPDATE OF declaration_id, organization_id ON declaration_exit_checklist_items
WHEN NOT EXISTS (
  SELECT 1 FROM customs_declarations d
  WHERE d.id=NEW.declaration_id AND d.organization_id=NEW.organization_id
)
BEGIN
  SELECT RAISE(ABORT, 'declaration exit checklist organization mismatch');
END;

-- Keep the legacy behavior: ordinary checklist completion advances to stage 6
-- only when every active item is complete. Once explicitly advanced to stage 6,
-- late checklist edits must not move the declaration backwards.
CREATE TRIGGER IF NOT EXISTS declaration_checklist_items_sync_stage
AFTER INSERT ON declaration_checklist_items
BEGIN
  UPDATE customs_declarations
  SET workflow_stage=CASE
    WHEN workflow_stage=6 THEN 6
    WHEN EXISTS (
      SELECT 1 FROM declaration_checklist_items i
      WHERE i.declaration_id=NEW.declaration_id
        AND i.organization_id=NEW.organization_id AND i.is_active=1
    ) AND NOT EXISTS (
      SELECT 1 FROM declaration_checklist_items i
      WHERE i.declaration_id=NEW.declaration_id
        AND i.organization_id=NEW.organization_id
        AND i.is_active=1 AND i.completed=0
    ) THEN 6
    ELSE 5
  END,
  updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
  WHERE id=NEW.declaration_id AND organization_id=NEW.organization_id;
END;

CREATE TRIGGER IF NOT EXISTS declaration_checklist_items_sync_stage_update
AFTER UPDATE OF completed, is_active ON declaration_checklist_items
BEGIN
  UPDATE customs_declarations
  SET workflow_stage=CASE
    WHEN workflow_stage=6 THEN 6
    WHEN EXISTS (
      SELECT 1 FROM declaration_checklist_items i
      WHERE i.declaration_id=NEW.declaration_id
        AND i.organization_id=NEW.organization_id AND i.is_active=1
    ) AND NOT EXISTS (
      SELECT 1 FROM declaration_checklist_items i
      WHERE i.declaration_id=NEW.declaration_id
        AND i.organization_id=NEW.organization_id
        AND i.is_active=1 AND i.completed=0
    ) THEN 6
    ELSE 5
  END,
  updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
  WHERE id=NEW.declaration_id AND organization_id=NEW.organization_id;
END;

CREATE TABLE IF NOT EXISTS customs_operation_rules (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  rule_name TEXT NOT NULL,
  hs_code_prefix TEXT NOT NULL,
  customs_path TEXT NOT NULL DEFAULT '',
  transport_mode TEXT NOT NULL DEFAULT '',
  checklist_counts TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(checklist_counts) AND json_type(checklist_counts)='object'),
  field_counts TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(field_counts) AND json_type(field_counts)='object'),
  workflow_stages TEXT NOT NULL DEFAULT '[4,6]' CHECK (json_valid(workflow_stages) AND json_type(workflow_stages)='array'),
  evidence_count INTEGER NOT NULL DEFAULT 0 CHECK (evidence_count>=0),
  confidence REAL NOT NULL DEFAULT 0 CHECK (confidence>=0 AND confidence<=1),
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','learned')),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_by TEXT,
  updated_by TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (organization_id, hs_code_prefix, customs_path, transport_mode)
);

CREATE INDEX IF NOT EXISTS customs_operation_rules_match_idx
  ON customs_operation_rules(organization_id, hs_code_prefix, customs_path, transport_mode, is_active);

CREATE TABLE IF NOT EXISTS customs_operation_learning_events (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  declaration_id TEXT NOT NULL UNIQUE,
  shipment_id TEXT,
  hs_code TEXT NOT NULL,
  customs_path TEXT NOT NULL DEFAULT '',
  checklist_snapshot TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(checklist_snapshot) AND json_type(checklist_snapshot)='array'),
  field_snapshot TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(field_snapshot) AND json_type(field_snapshot)='object'),
  workflow_stages TEXT NOT NULL DEFAULT '[4,6]' CHECK (json_valid(workflow_stages) AND json_type(workflow_stages)='array'),
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (declaration_id) REFERENCES customs_declarations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS customs_operation_learning_events_match_idx
  ON customs_operation_learning_events(organization_id, hs_code, customs_path, created_at DESC);
CREATE INDEX IF NOT EXISTS customs_operation_learning_events_shipment_idx
  ON customs_operation_learning_events(organization_id, shipment_id, created_at DESC);

CREATE TRIGGER IF NOT EXISTS customs_operation_learning_events_tenant_insert
BEFORE INSERT ON customs_operation_learning_events
WHEN NOT EXISTS (
  SELECT 1 FROM customs_declarations d
  WHERE d.id=NEW.declaration_id AND d.organization_id=NEW.organization_id
)
BEGIN
  SELECT RAISE(ABORT, 'customs operation learning organization mismatch');
END;
