#!/usr/bin/env python3
"""Verify the additive Cloudflare D1 case-permits migration with SQLite only."""
from __future__ import annotations

import json
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "supabase/migrations-cloudflare/0011_case_permits.sql"


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
      CREATE TABLE organizations (
        id TEXT PRIMARY KEY,
        name TEXT
      );
      CREATE TABLE cases (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL
      );
      INSERT INTO organizations(id, name) VALUES ('org-1','Tenant 1'),('org-2','Tenant 2');
      INSERT INTO cases(id, organization_id) VALUES ('case-1','org-1'),('case-2','org-2');
    """)

    db.executescript(MIGRATION.read_text(encoding="utf-8"))
    db.execute("""
      INSERT INTO permits (
        id, organization_id, case_id, permit_type, issuing_authority
      ) VALUES ('permit-1','org-1','case-1','health','Health Authority')
    """)
    row = db.execute("""
      SELECT id, organization_id, case_id, permit_type, issuing_authority, status
      FROM permits WHERE id='permit-1'
    """).fetchone()
    assert row == ('permit-1','org-1','case-1','health','Health Authority','pending')

    must_fail(
        lambda: db.execute("""
          INSERT INTO permits (
            id, organization_id, case_id, permit_type, issuing_authority, status
          ) VALUES ('invalid-status','org-1','case-1','health','Authority','issued')
        """),
        "unsupported permit status was accepted",
    )
    must_fail(
        lambda: db.execute("""
          INSERT INTO permits (
            id, organization_id, case_id, permit_type, issuing_authority
          ) VALUES ('cross-tenant','org-2','case-1','health','Authority')
        """),
        "permit linked to another organization's case was accepted",
    )
    must_fail(
        lambda: db.execute("""
          UPDATE permits SET organization_id='org-2' WHERE id='permit-1'
        """),
        "permit tenant reassignment was accepted",
    )

    db.execute("DELETE FROM cases WHERE id='case-1'")
    remaining = db.execute("SELECT COUNT(*) FROM permits WHERE id='permit-1'").fetchone()[0]
    assert remaining == 0, "case deletion did not cascade to its permits"

    indexes = {
        row[0] for row in db.execute(
            "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='permits'"
        ).fetchall()
    }
    assert 'permits_org_case_created_idx' in indexes
    assert 'permits_org_status_idx' in indexes

    print(json.dumps({
        "ok": True,
        "migration": MIGRATION.name,
        "checks": [
            "canonical permit status default",
            "permit status allowlist",
            "organization-to-case isolation",
            "tenant reassignment rejection",
            "case deletion cascade",
            "organization/status indexes",
        ],
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
