#!/usr/bin/env python3
"""Verify declaration exit checklist D1 migration with an in-memory SQLite database only."""
from __future__ import annotations

import json
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "supabase/migrations-cloudflare/0012_customs_declaration_exit_checklists.sql"


def must_fail(fn, message: str) -> None:
    try:
        fn()
    except sqlite3.IntegrityError:
        return
    raise AssertionError(message)


def main() -> None:
    db = sqlite3.connect(":memory:")
    db.execute("PRAGMA foreign_keys = ON")
    db.executescript("""
      CREATE TABLE organizations (id TEXT PRIMARY KEY, name TEXT);
      CREATE TABLE cases (id TEXT PRIMARY KEY, organization_id TEXT NOT NULL);
      CREATE TABLE permits (id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, case_id TEXT NOT NULL);
      CREATE TABLE customs_declarations (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        workflow_stage INTEGER NOT NULL DEFAULT 4,
        updated_at TEXT
      );
      INSERT INTO organizations(id,name) VALUES ('org-1','Tenant 1'),('org-2','Tenant 2');
      INSERT INTO cases(id,organization_id) VALUES ('case-1','org-1'),('case-2','org-2');
      INSERT INTO customs_declarations(id,organization_id,workflow_stage)
        VALUES ('decl-1','org-1',4),('decl-2','org-2',4);
    """)

    db.executescript(MIGRATION.read_text(encoding="utf-8"))

    labels = [
        "مالیات علی الحساب",
        "درخواست ضمانتنامه حقوق ورودی و ارزش افزوده",
        "ارزیابی",
        "آزمایشگاه",
        "مجوز استاندارد",
        "نوبت کارشناسی",
        "کد ساتا",
        "تبصره دو منطقه آزاد",
    ]
    for index, label in enumerate(labels, 1):
        db.execute("""
          INSERT INTO declaration_checklist_items
            (id,organization_id,declaration_id,item_key,item_label,sort_order,source)
          VALUES (?,?,?,?,?,?,'system')
        """, (f"item-{index}", "org-1", "decl-1", label, label, index * 10))

    stage_after_incomplete = db.execute(
        "SELECT workflow_stage FROM customs_declarations WHERE id='decl-1'"
    ).fetchone()[0]
    assert stage_after_incomplete == 5, "incomplete checklist did not move the workflow to stage 5"

    db.execute("UPDATE declaration_checklist_items SET completed=1 WHERE declaration_id='decl-1'")
    stage_after_complete = db.execute(
        "SELECT workflow_stage FROM customs_declarations WHERE id='decl-1'"
    ).fetchone()[0]
    assert stage_after_complete == 6, "fully completed checklist did not move the workflow to stage 6"

    db.execute("""
      UPDATE declaration_checklist_items SET completed=0
      WHERE declaration_id='decl-1' AND item_key=?
    """, (labels[0],))
    stage_after_late_change = db.execute(
        "SELECT workflow_stage FROM customs_declarations WHERE id='decl-1'"
    ).fetchone()[0]
    assert stage_after_late_change == 6, "late checklist edit incorrectly moved stage 6 backwards"

    must_fail(
        lambda: db.execute("""
          INSERT INTO declaration_checklist_items
            (id,organization_id,declaration_id,item_key,item_label)
          VALUES ('cross-tenant','org-2','decl-1','bad','bad')
        """),
        "cross-organization checklist link was accepted",
    )

    exit_keys = [
        "warehouse_invoice_initial",
        "warehouse_invoice_supplement",
        "transport_power_of_attorney",
    ]
    for key in exit_keys:
        db.execute("""
          INSERT INTO declaration_exit_checklist_items
            (id,organization_id,declaration_id,item_key)
          VALUES (?,?,?,?)
        """, (f"exit-{key}", "org-1", "decl-1", key))
    must_fail(
        lambda: db.execute("""
          INSERT INTO declaration_exit_checklist_items
            (id,organization_id,declaration_id,item_key)
          VALUES ('bad-exit','org-1','decl-1','unapproved_item')
        """),
        "non-canonical exit checklist key was accepted",
    )
    must_fail(
        lambda: db.execute("""
          INSERT INTO declaration_exit_checklist_items
            (id,organization_id,declaration_id,item_key)
          VALUES ('cross-exit','org-2','decl-1','warehouse_invoice_initial')
        """),
        "cross-organization exit checklist link was accepted",
    )

    db.execute("""
      INSERT INTO customs_operation_rules
        (id,organization_id,rule_name,hs_code_prefix,customs_path,transport_mode,
         checklist_counts,field_counts,workflow_stages,evidence_count,confidence,source)
      VALUES ('rule-1','org-1','HS rule','1001','red','sea',?,?, '[4,6]',2,0.75,'learned')
    """, (json.dumps({"ارزیابی": 2}, ensure_ascii=False), json.dumps({"sata_code": 2})))
    must_fail(
        lambda: db.execute("""
          INSERT INTO customs_operation_rules
            (id,organization_id,rule_name,hs_code_prefix,checklist_counts)
          VALUES ('bad-json','org-1','bad','1001','{not-json')
        """),
        "invalid checklist JSON was accepted",
    )

    db.execute("""
      INSERT INTO customs_operation_learning_events
        (id,organization_id,declaration_id,hs_code,checklist_snapshot,field_snapshot)
      VALUES ('learn-1','org-1','decl-1','1001','[]','{}')
    """)
    must_fail(
        lambda: db.execute("""
          INSERT INTO customs_operation_learning_events
            (id,organization_id,declaration_id,hs_code)
          VALUES ('cross-learning','org-2','decl-1','1001')
        """),
        "cross-organization learning event was accepted",
    )

    tables = {
        row[0] for row in db.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()
    }
    required = {
        "declaration_checklist_items",
        "declaration_exit_checklist_items",
        "customs_operation_rules",
        "customs_operation_learning_events",
    }
    assert required.issubset(tables), "one or more D1 checklist migration tables are missing"

    print(json.dumps({
        "ok": True,
        "migration": MIGRATION.name,
        "checks": [
            "stage 5 for incomplete operations checklist",
            "stage 6 after all active checklist items complete",
            "preserve stage 6 after later checklist edits",
            "tenant isolation for both checklists and learning events",
            "three canonical exit checklist keys only",
            "valid JSON and constrained learned-rule data",
            "all four D1 tables created",
        ],
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
