#!/usr/bin/env python3
"""Verify read-only D1 legacy registration-order candidate matching."""
from __future__ import annotations

import json
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "supabase/migrations-cloudflare/0014_registration_order_legacy_candidates.sql"


def main() -> None:
    db = sqlite3.connect(":memory:")
    db.executescript("""
      CREATE TABLE cases (
        id TEXT PRIMARY KEY, organization_id TEXT NOT NULL,
        registration_order_no TEXT
      );
      CREATE TABLE shipments (
        id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, client_id TEXT,
        case_id TEXT, registration_order_id TEXT, display_name TEXT,
        bill_of_lading_no TEXT, net_weight_kg REAL, gross_weight_kg REAL
      );
      CREATE TABLE shipment_customs_data (
        shipment_id TEXT NOT NULL, organization_id TEXT NOT NULL,
        registration_order_no TEXT, net_weight_kg REAL, gross_weight_kg REAL,
        invoice_amount REAL, invoice_currency TEXT
      );
      CREATE TABLE registration_orders (
        id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, client_id TEXT,
        case_id TEXT, order_number TEXT NOT NULL
      );
    """)
    db.executescript(MIGRATION.read_text(encoding="utf-8"))

    db.executemany(
        "INSERT INTO registration_orders(id,organization_id,client_id,case_id,order_number) VALUES(?,?,?,?,?)",
        [
            ("ro-1", "org-1", "client-1", None, "۱۲۳۴۵"),
            ("ro-foreign", "org-2", "client-1", None, "12345"),
            ("ro-other-client", "org-1", "client-2", None, "12345"),
        ],
    )
    db.executemany(
        "INSERT INTO shipments(id,organization_id,client_id,case_id,registration_order_id,display_name,bill_of_lading_no,net_weight_kg,gross_weight_kg) VALUES(?,?,?,?,?,?,?,?,?)",
        [
            ("ship-candidate", "org-1", "client-1", None, None, "Legacy candidate", "BL-1", 100, 110),
            ("ship-direct", "org-1", "client-1", None, "ro-1", "Directly linked", "BL-2", 200, 220),
            ("ship-other-client", "org-1", "client-2", None, None, "Other client", "BL-3", 300, 330),
            ("ship-other-org", "org-2", "client-1", None, None, "Other organization", "BL-4", 400, 440),
        ],
    )
    db.executemany(
        "INSERT INTO shipment_customs_data(shipment_id,organization_id,registration_order_no,net_weight_kg,gross_weight_kg,invoice_amount,invoice_currency) VALUES(?,?,?,?,?,?,?)",
        [
            ("ship-candidate", "org-1", "12345", 100, 110, 500, "USD"),
            ("ship-direct", "org-1", "12345", 200, 220, 600, "USD"),
            ("ship-other-client", "org-1", "12345", 300, 330, 700, "USD"),
            ("ship-other-org", "org-2", "12345", 400, 440, 800, "USD"),
        ],
    )

    # Duplicate normalized order numbers are ambiguous and must not produce candidates.
    db.execute(
        "INSERT INTO registration_orders(id,organization_id,client_id,case_id,order_number) VALUES(?,?,?,?,?)",
        ("ro-duplicate", "org-1", "client-1", None, "12345"),
    )
    assert db.execute("SELECT COUNT(*) FROM registration_order_legacy_match_candidates").fetchone()[0] == 0
    db.execute("DELETE FROM registration_orders WHERE id='ro-duplicate'")

    # Case-linked and conflicting case references must not be suggested.
    db.execute("INSERT INTO cases(id,organization_id,registration_order_no) VALUES('case-linked','org-1',NULL)")
    db.execute("UPDATE registration_orders SET case_id='case-linked' WHERE id='ro-1'")
    db.execute(
        "INSERT INTO shipments(id,organization_id,client_id,case_id,registration_order_id,display_name,net_weight_kg,gross_weight_kg) VALUES('ship-case-linked','org-1','client-1','case-linked',NULL,'Case linked',50,55)"
    )
    db.execute(
        "INSERT INTO shipment_customs_data(shipment_id,organization_id,registration_order_no,invoice_amount,invoice_currency) VALUES('ship-case-linked','org-1','12345',250,'USD')"
    )
    db.execute("UPDATE registration_orders SET case_id=NULL WHERE id='ro-1'")
    db.execute("INSERT INTO cases(id,organization_id,registration_order_no) VALUES('case-conflict','org-1','99999')")
    db.execute(
        "INSERT INTO shipments(id,organization_id,client_id,case_id,registration_order_id,display_name,net_weight_kg,gross_weight_kg) VALUES('ship-case-conflict','org-1','client-1','case-conflict',NULL,'Case conflict',60,66)"
    )
    db.execute(
        "INSERT INTO shipment_customs_data(shipment_id,organization_id,registration_order_no,invoice_amount,invoice_currency) VALUES('ship-case-conflict','org-1','12345',300,'USD')"
    )

    rows = db.execute("""
      SELECT registration_order_id, shipment_id, order_number, customs_registration_order_no,
             candidate_net_weight_kg, candidate_invoice_amount, candidate_source
      FROM registration_order_legacy_match_candidates
      WHERE organization_id='org-1'
    """).fetchall()
    assert rows == [(
        "ro-1", "ship-candidate", "۱۲۳۴۵", "12345", 100.0, 500.0,
        "shipment_customs_data.registration_order_no",
    )], rows

    # The candidate view must remain read-only: no direct FK or order totals are changed.
    linked = db.execute("SELECT registration_order_id FROM shipments WHERE id='ship-candidate'").fetchone()[0]
    assert linked is None
    assert db.execute("SELECT COUNT(*) FROM registration_order_legacy_match_candidates WHERE organization_id='org-2'").fetchone()[0] == 0

    indexes = {row[0] for row in db.execute(
        "SELECT name FROM sqlite_master WHERE type='index'"
    ).fetchall()}
    expected_indexes = {
        "shipments_org_registration_order_client_case_idx",
        "shipment_customs_data_org_registration_order_shipment_idx",
        "registration_orders_org_client_order_number_idx",
        "cases_org_registration_order_no_idx",
    }
    assert expected_indexes.issubset(indexes)

    print(json.dumps({
        "ok": True,
        "migration": MIGRATION.name,
        "checks": [
            "Persian/Arabic digit normalization",
            "unique organization/client match only",
            "ambiguous references excluded",
            "direct and case-linked references excluded",
            "cross-client and cross-organization isolation",
            "candidate view does not auto-link or alter capacity",
            "supporting indexes exist",
        ],
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
