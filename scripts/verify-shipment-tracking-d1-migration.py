#!/usr/bin/env python3
"""Verify the Cloudflare D1 shipment tracking history migration in isolated SQLite."""
from __future__ import annotations

import json
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "supabase/migrations-cloudflare/0018_shipment_tracking_events.sql"


def main() -> None:
    db = sqlite3.connect(":memory:")
    db.execute("PRAGMA foreign_keys = ON")
    db.executescript("""
      CREATE TABLE shipments (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        ship_passed INTEGER NOT NULL DEFAULT 0,
        ship_passed_at TEXT,
        ship_passed_by TEXT,
        updated_at TEXT
      );
      CREATE TABLE customs_os_audit_events (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        actor_user_id TEXT NOT NULL,
        action TEXT NOT NULL CHECK (action IN ('create','update','delete')),
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        before_json TEXT,
        after_json TEXT,
        request_id TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
      INSERT INTO shipments(id,organization_id) VALUES ('shipment-a','org-a');
    """)
    db.executescript(MIGRATION.read_text(encoding="utf-8"))

    db.execute("""
      INSERT INTO shipment_tracking_events
      (id,organization_id,shipment_id,event_code,event_time,time_type,location,notes,source,created_by)
      VALUES ('event-a','org-a','shipment-a','departed','2026-11-28T12:00:00.000Z','actual',
              'Bandar Abbas','Vessel departed','Customs OS','user-a')
    """)
    row = db.execute("""
      SELECT organization_id,shipment_id,event_code,time_type
      FROM shipment_tracking_events WHERE id='event-a'
    """).fetchone()
    assert row == ('org-a','shipment-a','departed','actual'), row

    try:
        db.execute("""
          INSERT INTO shipment_tracking_events
          (id,organization_id,shipment_id,event_code,event_time,time_type,created_by)
          VALUES ('bad-event','org-a','shipment-a','not-valid','2026-11-28T12:00:00Z','actual','user-a')
        """)
        raise AssertionError("invalid event code was accepted")
    except sqlite3.IntegrityError:
        pass

    try:
        db.execute("""
          INSERT INTO shipment_tracking_events
          (id,organization_id,shipment_id,event_code,event_time,time_type,created_by)
          VALUES ('foreign-event','org-a','missing-shipment','departed','2026-11-28T12:00:00Z','actual','user-a')
        """)
        raise AssertionError("event for missing shipment was accepted")
    except sqlite3.IntegrityError:
        pass

    indexes = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='index'")}
    assert {
      "shipment_tracking_events_org_shipment_time_idx",
      "shipment_tracking_events_org_created_idx",
    }.issubset(indexes), indexes

    print(json.dumps({
      "ok": True,
      "migration": MIGRATION.name,
      "checks": [
        "shipment-scoped event insert",
        "event-code allowlist",
        "shipment foreign-key enforcement",
        "time-type contract",
        "organization/shipment indexes",
      ],
    }))


if __name__ == "__main__":
    main()
