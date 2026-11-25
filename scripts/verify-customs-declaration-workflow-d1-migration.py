#!/usr/bin/env python3
"""Execute the Cloudflare customs declaration workflow migration against SQLite in memory."""
from __future__ import annotations

import json
import sqlite3
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "supabase/migrations-cloudflare/0010_customs_declaration_workflow.sql"


def expect_integrity_error(fn, message: str) -> None:
    try:
        fn()
    except sqlite3.IntegrityError:
        return
    raise AssertionError(message)


def main() -> None:
    connection = sqlite3.connect(":memory:")
    connection.execute("PRAGMA foreign_keys = ON")
    connection.executescript("""
      CREATE TABLE customs_declarations (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        shipment_id TEXT,
        customs_path TEXT,
        customs_regime TEXT
      );
      CREATE TABLE shipment_customs_data (
        shipment_id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        sata_code TEXT
      );
      INSERT INTO customs_declarations
        (id, organization_id, shipment_id, customs_path, customs_regime)
      VALUES ('decl-1', 'org-1', 'shipment-1', 'red', 'import_definitive');
    """)

    sql = MIGRATION.read_text(encoding="utf-8")
    connection.executescript(sql)

    defaults = {
        "evaluation": {"status": "required", "expert_requested": True},
        "expertise": {"standard": {"expert_review": "pending"}},
        "cashier": {"method": "pending"},
        "loading_permit": {"sata_code": ""},
        "exit": {"loading_permission_status": "pending"},
        "port": {"warehouse_receipt_date": ""},
    }
    connection.execute("""
      INSERT INTO customs_declaration_workflow (
        id, organization_id, declaration_id, current_stage,
        evaluation_state, expertise_state, cashier_state,
        loading_permit_state, exit_state, port_charges_state,
        procedure_state, created_by, updated_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        "workflow-1", "org-1", "decl-1", "evaluation",
        json.dumps(defaults["evaluation"]),
        json.dumps(defaults["expertise"]),
        json.dumps(defaults["cashier"]),
        json.dumps(defaults["loading_permit"]),
        json.dumps(defaults["exit"]),
        json.dumps(defaults["port"]),
        "{}", "user-1", "user-1",
    ))

    events = connection.execute("""
      SELECT event_type, changed_fields, previous_snapshot, snapshot
      FROM customs_declaration_workflow_events
      WHERE workflow_id = 'workflow-1'
      ORDER BY created_at, id
    """).fetchall()
    assert len(events) == 1, f"expected 1 create event, got {len(events)}"
    assert events[0][0] == "created"
    assert events[0][2] is None
    create_fields = json.loads(events[0][1])
    assert "procedure_state" in create_fields

    connection.execute("""
      UPDATE customs_declaration_workflow
      SET expertise_state = ?, updated_by = 'user-2',
          updated_at = '2026-11-25T09:00:00.000Z'
      WHERE id = 'workflow-1'
    """, (json.dumps({"standard": {"expert_review": "approved", "inspection_fee": 0}}),))
    events = connection.execute("""
      SELECT event_type, changed_fields, previous_snapshot, snapshot
      FROM customs_declaration_workflow_events
      WHERE workflow_id = 'workflow-1'
      ORDER BY created_at, id
    """).fetchall()
    assert len(events) == 2
    assert events[-1][0] == "saved"
    assert json.loads(events[-1][1]) == ["expertise_state"]
    assert json.loads(events[-1][2])["expertise_state"] == defaults["expertise"]
    assert json.loads(events[-1][3])["expertise_state"]["standard"]["expert_review"] == "approved"

    connection.execute("""
      UPDATE customs_declaration_workflow
      SET current_stage = 'expertise', updated_by = 'user-2',
          updated_at = '2026-11-25T09:00:00.001Z'
      WHERE id = 'workflow-1'
    """)
    last = connection.execute("""
      SELECT event_type, changed_fields FROM customs_declaration_workflow_events
      WHERE workflow_id = 'workflow-1' ORDER BY created_at DESC, id DESC LIMIT 1
    """).fetchone()
    assert last[0] == "stage_changed"
    assert "current_stage" in json.loads(last[1])

    connection.execute("""
      UPDATE customs_declaration_workflow
      SET last_event_type = 'rollback', current_stage = 'evaluation',
          updated_by = 'user-1', updated_at = '2026-11-25T09:00:00.002Z'
      WHERE id = 'workflow-1'
    """)
    last = connection.execute("""
      SELECT event_type FROM customs_declaration_workflow_events
      WHERE workflow_id = 'workflow-1' ORDER BY created_at DESC, id DESC LIMIT 1
    """).fetchone()
    assert last[0] == "rollback"

    event_id = connection.execute("""
      SELECT id FROM customs_declaration_workflow_events
      WHERE workflow_id = 'workflow-1' ORDER BY created_at DESC, id DESC LIMIT 1
    """).fetchone()[0]
    expect_integrity_error(
        lambda: connection.execute(
            "UPDATE customs_declaration_workflow_events SET current_stage='tampered' WHERE id=?",
            (event_id,),
        ),
        "workflow event update was not rejected",
    )
    expect_integrity_error(
        lambda: connection.execute(
            "DELETE FROM customs_declaration_workflow_events WHERE id=?",
            (event_id,),
        ),
        "workflow event deletion was not rejected",
    )
    expect_integrity_error(
        lambda: connection.execute("""
          INSERT INTO customs_declaration_workflow (
            id, organization_id, declaration_id, evaluation_state, expertise_state,
            cashier_state, loading_permit_state, exit_state, port_charges_state, procedure_state
          ) VALUES ('bad-json', 'org-1', 'decl-2', '{broken', '{}', '{}', '{}', '{}', '{}', '{}')
        """),
        "invalid JSON state was accepted",
    )

    count = connection.execute(
        "SELECT COUNT(*) FROM customs_declaration_workflow_events WHERE workflow_id='workflow-1'"
    ).fetchone()[0]
    assert count == 4, f"expected 4 immutable events, got {count}"
    print(json.dumps({
        "ok": True,
        "migration": MIGRATION.name,
        "workflowEvents": count,
        "checks": [
            "creation trigger",
            "before/after activity snapshot",
            "stage transition event",
            "rollback event classification",
            "immutable event update/delete",
            "JSON state validation",
        ],
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
