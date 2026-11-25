-- D1 parity for the canonical customs-declaration workflow.
-- Mirrors the source workflow state and immutable before/after activity history.
-- This migration is additive; it does not change shipment/declaration stage logic.

CREATE TABLE IF NOT EXISTS customs_declaration_workflow (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  declaration_id TEXT NOT NULL UNIQUE,
  current_stage TEXT NOT NULL DEFAULT 'evaluation'
    CHECK (current_stage IN (
      'evaluation','expertise','cashier','loading_permit','exit','port_charges',
      'abandoned','completed','documents','permits','declaration','valuation','loading',
      'guarantee','use_period','re_export'
    )),
  evaluation_state TEXT NOT NULL DEFAULT '{"status":"not_required","evaluator_number":"","expert_requested":false,"expert_request_note":""}'
    CHECK (json_valid(evaluation_state) AND json_type(evaluation_state) = 'object'),
  expertise_state TEXT NOT NULL DEFAULT '{"appointment_status":"not_requested","appointment_number":"","road_authority_status":"not_required","plant_quarantine_status":"not_required","standard":{"expert_review":"pending","inspection_status":"not_requested","inspection_company":"","inspection_fee":null,"inspection_paid":false,"inspection_invoice_received":false,"inspection_invoice_status":"pending","sample_status":"not_sent","laboratory":"","results_uploaded":false,"standard_fee":null,"standard_fee_paid":false,"standard_notified":false}}'
    CHECK (json_valid(expertise_state) AND json_type(expertise_state) = 'object'),
  cashier_state TEXT NOT NULL DEFAULT '{"method":"pending","cash_paid_irr":null,"guarantee_duties":false,"guarantee_vat":false,"guarantee_reference":""}'
    CHECK (json_valid(cashier_state) AND json_type(cashier_state) = 'object'),
  loading_permit_state TEXT NOT NULL DEFAULT '{"clause2_request_status":"not_required","tax_permission_status":"pending","central_bank_status":"pending","sata_code":"","clearance_90_percent_requested":false,"comment":""}'
    CHECK (json_valid(loading_permit_state) AND json_type(loading_permit_state) = 'object'),
  exit_state TEXT NOT NULL DEFAULT '{"loading_permission_status":"pending","financial_registration_status":"pending","weighbridge_required":false,"weighbridge_demand_irr":null,"weighbridge_paid":false,"loading_completed_at":""}'
    CHECK (json_valid(exit_state) AND json_type(exit_state) = 'object'),
  port_charges_state TEXT NOT NULL DEFAULT '{"insurance_policy_no":"","insurance_issue_date":"","insurance_followup_status":"pending","warehouse_receipt_date":"","initial_invoice_status":"pending","transport_power_of_attorney_status":"pending","loading_form_received_at":"","loading_started_at":"","supplemental_invoice_status":"not_required","last_truck_loaded_at":""}'
    CHECK (json_valid(port_charges_state) AND json_type(port_charges_state) = 'object'),
  procedure_state TEXT NOT NULL DEFAULT '{}'
    CHECK (json_valid(procedure_state) AND json_type(procedure_state) = 'object'),
  notes TEXT,
  created_by TEXT,
  updated_by TEXT,
  last_event_type TEXT NOT NULL DEFAULT 'saved'
    CHECK (last_event_type IN ('saved','rollback')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (declaration_id) REFERENCES customs_declarations(id) ON DELETE CASCADE
);

CREATE TRIGGER IF NOT EXISTS customs_declaration_workflow_tenant_insert
BEFORE INSERT ON customs_declaration_workflow
WHEN NOT EXISTS (
  SELECT 1 FROM customs_declarations d
  WHERE d.id = NEW.declaration_id AND d.organization_id = NEW.organization_id
)
BEGIN
  SELECT RAISE(ABORT, 'workflow declaration organization mismatch');
END;

CREATE TRIGGER IF NOT EXISTS customs_declaration_workflow_tenant_update
BEFORE UPDATE OF declaration_id, organization_id ON customs_declaration_workflow
WHEN NOT EXISTS (
  SELECT 1 FROM customs_declarations d
  WHERE d.id = NEW.declaration_id AND d.organization_id = NEW.organization_id
)
BEGIN
  SELECT RAISE(ABORT, 'workflow declaration organization mismatch');
END;

CREATE INDEX IF NOT EXISTS customs_declaration_workflow_org_stage_idx
  ON customs_declaration_workflow(organization_id, current_stage);
CREATE INDEX IF NOT EXISTS customs_declaration_workflow_org_updated_idx
  ON customs_declaration_workflow(organization_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS customs_declaration_workflow_events (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  declaration_id TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('created','stage_changed','saved','rollback')),
  previous_stage TEXT,
  current_stage TEXT NOT NULL,
  changed_fields TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(changed_fields) AND json_type(changed_fields) = 'array'),
  previous_snapshot TEXT
    CHECK (previous_snapshot IS NULL OR (json_valid(previous_snapshot) AND json_type(previous_snapshot) = 'object')),
  snapshot TEXT NOT NULL
    CHECK (json_valid(snapshot) AND json_type(snapshot) = 'object'),
  actor_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (workflow_id) REFERENCES customs_declaration_workflow(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS customs_declaration_workflow_events_timeline_idx
  ON customs_declaration_workflow_events(organization_id, declaration_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS customs_declaration_workflow_events_workflow_idx
  ON customs_declaration_workflow_events(organization_id, workflow_id, created_at DESC, id DESC);

CREATE TRIGGER IF NOT EXISTS customs_declaration_workflow_events_tenant_insert
BEFORE INSERT ON customs_declaration_workflow_events
WHEN NOT EXISTS (
  SELECT 1 FROM customs_declaration_workflow w
  WHERE w.id = NEW.workflow_id
    AND w.organization_id = NEW.organization_id
    AND w.declaration_id = NEW.declaration_id
)
BEGIN
  SELECT RAISE(ABORT, 'workflow event organization mismatch');
END;

CREATE TRIGGER IF NOT EXISTS customs_declaration_workflow_events_after_insert
AFTER INSERT ON customs_declaration_workflow
BEGIN
  INSERT INTO customs_declaration_workflow_events (
    id, organization_id, declaration_id, workflow_id, event_type,
    previous_stage, current_stage, changed_fields, previous_snapshot,
    snapshot, actor_id, created_at
  ) VALUES (
    lower(hex(randomblob(16))),
    NEW.organization_id,
    NEW.declaration_id,
    NEW.id,
    'created',
    NULL,
    NEW.current_stage,
    json_array(
      'current_stage','evaluation_state','expertise_state','cashier_state',
      'loading_permit_state','exit_state','port_charges_state','procedure_state','notes'
    ),
    NULL,
    json_object(
      'evaluation_state', json(NEW.evaluation_state),
      'expertise_state', json(NEW.expertise_state),
      'cashier_state', json(NEW.cashier_state),
      'loading_permit_state', json(NEW.loading_permit_state),
      'exit_state', json(NEW.exit_state),
      'port_charges_state', json(NEW.port_charges_state),
      'procedure_state', json(NEW.procedure_state),
      'notes', NEW.notes
    ),
    COALESCE(NEW.updated_by, NEW.created_by),
    COALESCE(NEW.created_at, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
END;

CREATE TRIGGER IF NOT EXISTS customs_declaration_workflow_events_after_update
AFTER UPDATE ON customs_declaration_workflow
WHEN
  OLD.current_stage IS NOT NEW.current_stage OR
  OLD.evaluation_state IS NOT NEW.evaluation_state OR
  OLD.expertise_state IS NOT NEW.expertise_state OR
  OLD.cashier_state IS NOT NEW.cashier_state OR
  OLD.loading_permit_state IS NOT NEW.loading_permit_state OR
  OLD.exit_state IS NOT NEW.exit_state OR
  OLD.port_charges_state IS NOT NEW.port_charges_state OR
  OLD.procedure_state IS NOT NEW.procedure_state OR
  OLD.notes IS NOT NEW.notes
BEGIN
  INSERT INTO customs_declaration_workflow_events (
    id, organization_id, declaration_id, workflow_id, event_type,
    previous_stage, current_stage, changed_fields, previous_snapshot,
    snapshot, actor_id, created_at
  ) VALUES (
    lower(hex(randomblob(16))),
    NEW.organization_id,
    NEW.declaration_id,
    NEW.id,
    CASE
      WHEN NEW.last_event_type = 'rollback' THEN 'rollback'
      WHEN OLD.current_stage IS NOT NEW.current_stage THEN 'stage_changed'
      ELSE 'saved'
    END,
    OLD.current_stage,
    NEW.current_stage,
    (
      SELECT json_group_array(field) FROM (
        SELECT 'current_stage' AS field WHERE OLD.current_stage IS NOT NEW.current_stage
        UNION ALL SELECT 'evaluation_state' WHERE OLD.evaluation_state IS NOT NEW.evaluation_state
        UNION ALL SELECT 'expertise_state' WHERE OLD.expertise_state IS NOT NEW.expertise_state
        UNION ALL SELECT 'cashier_state' WHERE OLD.cashier_state IS NOT NEW.cashier_state
        UNION ALL SELECT 'loading_permit_state' WHERE OLD.loading_permit_state IS NOT NEW.loading_permit_state
        UNION ALL SELECT 'exit_state' WHERE OLD.exit_state IS NOT NEW.exit_state
        UNION ALL SELECT 'port_charges_state' WHERE OLD.port_charges_state IS NOT NEW.port_charges_state
        UNION ALL SELECT 'procedure_state' WHERE OLD.procedure_state IS NOT NEW.procedure_state
        UNION ALL SELECT 'notes' WHERE OLD.notes IS NOT NEW.notes
      )
    ),
    json_object(
      'evaluation_state', json(OLD.evaluation_state),
      'expertise_state', json(OLD.expertise_state),
      'cashier_state', json(OLD.cashier_state),
      'loading_permit_state', json(OLD.loading_permit_state),
      'exit_state', json(OLD.exit_state),
      'port_charges_state', json(OLD.port_charges_state),
      'procedure_state', json(OLD.procedure_state),
      'notes', OLD.notes
    ),
    json_object(
      'evaluation_state', json(NEW.evaluation_state),
      'expertise_state', json(NEW.expertise_state),
      'cashier_state', json(NEW.cashier_state),
      'loading_permit_state', json(NEW.loading_permit_state),
      'exit_state', json(NEW.exit_state),
      'port_charges_state', json(NEW.port_charges_state),
      'procedure_state', json(NEW.procedure_state),
      'notes', NEW.notes
    ),
    COALESCE(NEW.updated_by, NEW.created_by),
    COALESCE(NEW.updated_at, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
END;

CREATE TRIGGER IF NOT EXISTS customs_declaration_workflow_events_no_update
BEFORE UPDATE ON customs_declaration_workflow_events
BEGIN
  SELECT RAISE(ABORT, 'workflow audit events are immutable');
END;

