#!/usr/bin/env python3
"""Verify the additive D1 case-exit migration using SQLite only."""
from __future__ import annotations

import json
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "supabase/migrations-cloudflare/0013_case_exit_operations.sql"


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
      CREATE TABLE cases (id TEXT PRIMARY KEY, organization_id TEXT NOT NULL);
      INSERT INTO cases(id,organization_id) VALUES ('case-1','org-1'),('case-2','org-2');
    """)
    db.executescript(MIGRATION.read_text(encoding="utf-8"))

    db.execute("""
      INSERT INTO case_exit_operations
        (id,organization_id,case_id,exit_status,exit_permit_no,exit_permit_date,created_by)
      VALUES ('exit-1','org-1','case-1','authorized','EP-1405','2026-11-26','admin-1')
    """)
    row = db.execute("""
      SELECT id,organization_id,case_id,exit_status,exit_permit_no,exit_permit_date
      FROM case_exit_operations WHERE id='exit-1'
    """).fetchone()
    assert row == ('exit-1','org-1','case-1','authorized','EP-1405','2026-11-26')

    must_fail(
        lambda: db.execute("""
          INSERT INTO case_exit_operations (id,organization_id,case_id,exit_status)
          VALUES ('bad-status','org-1','case-1','unknown')
        """),
        "unsupported exit status was accepted",
    )
    must_fail(
        lambda: db.execute("""
          INSERT INTO case_exit_operations (id,organization_id,case_id)
          VALUES ('cross-tenant','org-2','case-1')
        """),
        "cross-organization case exit was accepted",
    )
    must_fail(
        lambda: db.execute("""
          UPDATE case_exit_operations SET organization_id='org-2' WHERE id='exit-1'
        """),
        "case exit tenant reassignment was accepted",
    )
    must_fail(
        lambda: db.execute("""
          INSERT INTO case_exit_operations (id,organization_id,case_id)
          VALUES ('duplicate-case','org-1','case-1')
        """),
        "more than one exit operation for a case was accepted",
    )

    indexes = {
        row[0] for row in db.execute(
            "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='case_exit_operations'"
        ).fetchall()
    }
    assert 'case_exit_operations_org_case_updated_idx' in indexes

    db.execute("DELETE FROM cases WHERE id='case-1'")
    remaining = db.execute("SELECT COUNT(*) FROM case_exit_operations WHERE id='exit-1'").fetchone()[0]
    assert remaining == 0, "case deletion did not cascade to its exit operation"

    print(json.dumps({
        "ok": True,
        "migration": MIGRATION.name,
        "checks": [
            "canonical exit status allowlist",
            "one exit operation per case",
            "organization-to-case isolation",
            "tenant reassignment rejection",
            "case deletion cascade",
            "organization/case/update index",
        ],
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
