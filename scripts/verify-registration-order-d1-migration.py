#!/usr/bin/env python3
"""Execute the Cloudflare D1 registration-order migration against an isolated SQLite fixture."""
from pathlib import Path
import sqlite3
import sys

ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "supabase/migrations-cloudflare/0006_registration_orders_api.sql"

def expect_integrity(action, marker):
    try:
        action()
    except sqlite3.IntegrityError as exc:
        if marker not in str(exc):
            raise AssertionError(f"Expected {marker!r}, got {str(exc)!r}") from exc
        return
    raise AssertionError(f"Expected SQLite integrity error containing {marker!r}")

def main():
    sql = MIGRATION.read_text(encoding="utf-8")
    db = sqlite3.connect(":memory:")
    db.execute("PRAGMA foreign_keys=ON")
    db.executescript("""
      CREATE TABLE registration_orders (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        case_id TEXT,
        order_number TEXT,
        order_date TEXT,
        status TEXT,
        tariff_code TEXT,
        quantity INTEGER,
        quantity_unit TEXT,
        value_amount REAL,
        currency TEXT,
        notes TEXT,
        created_at TEXT,
        updated_at TEXT,
        client_id TEXT,
        net_weight_kg REAL,
        gross_weight_kg REAL,
        bank_name TEXT,
        bank_branch TEXT,
        bank_branch_code TEXT,
        payment_instrument_code TEXT,
        is_closed INTEGER NOT NULL DEFAULT 0,
        closed_at TEXT
      );
      CREATE TABLE cases (
        id TEXT PRIMARY KEY,
        organization_id TEXT,
        registration_order_no TEXT,
        net_weight_kg REAL,
        gross_weight_kg REAL
      );
      CREATE TABLE shipments (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        case_id TEXT,
        registration_order_id TEXT,
        client_id TEXT,
        net_weight_kg REAL,
        gross_weight_kg REAL
      );
      CREATE TABLE shipment_customs_data (
        shipment_id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        net_weight_kg REAL,
        gross_weight_kg REAL,
        invoice_amount REAL,
        invoice_currency TEXT
      );
      CREATE TABLE customs_os_audit_events (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        actor_user_id TEXT NOT NULL,
        action TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        before_json TEXT,
        after_json TEXT,
        request_id TEXT,
        created_at TEXT NOT NULL
      );
    """)
    statement = ""
    statement_start = 1
    statement_number = 0
    try:
        for line_number, line in enumerate(sql.splitlines(keepends=True), start=1):
            if not statement.strip():
                statement_start = line_number
            statement += line
            if sqlite3.complete_statement(statement):
                statement_number += 1
                db.execute(statement)
                statement = ""
        if statement.strip():
            raise AssertionError("D1 migration ended with an incomplete SQL statement.")
    except sqlite3.Error as exc:
        excerpt = " ".join(statement.strip().split())[:420]
        raise AssertionError(
            "D1 migration SQL failed in SQLite at "
            f"statement {statement_number + 1}, lines {statement_start}-{line_number}: "
            f"{exc}. SQL: {excerpt}"
        ) from exc

    # Parent order + one internal shipment at half capacity.
    db.execute("""
      INSERT INTO registration_orders
      (id, organization_id, order_number, status, value_amount, currency,
       client_id, net_weight_kg, gross_weight_kg, is_closed, created_at, updated_at)
      VALUES ('order-a','org-a','12345','received',500,'USD',
              'client-a',1000,1100,0,'2026-01-01','2026-01-01')
    """)
    db.execute("""
      INSERT INTO shipments
      (id, organization_id, registration_order_id, client_id, net_weight_kg, gross_weight_kg)
      VALUES ('shipment-a','org-a','order-a','client-a',500,550)
    """)
    db.execute("""
      INSERT INTO shipment_customs_data
      (shipment_id, organization_id, invoice_amount, invoice_currency)
      VALUES ('shipment-a','org-a',250,'USD')
    """)

    # A 400 kg allocation is valid; a second one fills the exact remaining
    # weight, gross-weight and value capacity.
    db.execute("""
      INSERT INTO registration_order_external_allocations
      (id, organization_id, registration_order_id, recipient_company, status,
       net_weight_kg, gross_weight_kg, value_amount, currency)
      VALUES ('alloc-a','org-a','order-a','Broker A','allocated',400,440,200,'USD')
    """)
    db.execute("""
      INSERT INTO registration_order_external_allocations
      (id, organization_id, registration_order_id, destination_customs, status,
       net_weight_kg, gross_weight_kg, value_amount, currency)
      VALUES ('alloc-b','org-a','order-a','Hassan Rood','allocated',100,110,50,'USD')
    """)

    # Capacity checks must include internal shipments and every active external allocation.
    expect_integrity(lambda: db.execute("""
      INSERT INTO registration_order_external_allocations
      (id, organization_id, registration_order_id, recipient_company, status,
       net_weight_kg, gross_weight_kg, value_amount, currency)
      VALUES ('alloc-over','org-a','order-a','Overbooked','allocated',1,1,1,'USD')
    """), "REGISTRATION_ORDER_NET_CAPACITY_EXCEEDED")

    # Updating an allocation cannot evade the same capacity guard.
    expect_integrity(lambda: db.execute("""
      UPDATE registration_order_external_allocations
      SET net_weight_kg=600, gross_weight_kg=660, value_amount=300
      WHERE id='alloc-b' AND organization_id='org-a'
    """), "REGISTRATION_ORDER_NET_CAPACITY_EXCEEDED")

    # Currency and tenant ownership are enforced by the database, not only the API.
    expect_integrity(lambda: db.execute("""
      INSERT INTO registration_order_external_allocations
      (id, organization_id, registration_order_id, recipient_company, status,
       net_weight_kg, gross_weight_kg, value_amount, currency)
      VALUES ('alloc-currency','org-a','order-a','Wrong currency','allocated',1,1,1,'AED')
    """), "REGISTRATION_ORDER_ALLOCATION_CURRENCY_MISMATCH")
    expect_integrity(lambda: db.execute("""
      INSERT INTO registration_order_external_allocations
      (id, organization_id, registration_order_id, recipient_company, status,
       net_weight_kg, gross_weight_kg, value_amount, currency)
      VALUES ('alloc-tenant','org-b','order-a','Other tenant','allocated',1,1,1,'USD')
    """), "REGISTRATION_ORDER_NOT_FOUND")

    # The master order cannot be reduced below committed internal/external totals,
    # and finalization requires exact net/gross/value reconciliation.
    expect_integrity(lambda: db.execute("""
      UPDATE registration_orders SET net_weight_kg=900
      WHERE id='order-a' AND organization_id='org-a'
    """), "ORDER_NET_WEIGHT_BELOW_ALLOCATED")
    db.execute("""
      UPDATE registration_orders SET is_closed=1, closed_at='2026-01-02', status='used'
      WHERE id='order-a' AND organization_id='org-a'
    """)
    expect_integrity(lambda: db.execute("""
      INSERT INTO registration_order_external_allocations
      (id, organization_id, registration_order_id, recipient_company, status,
       net_weight_kg, gross_weight_kg, value_amount, currency)
      VALUES ('alloc-closed','org-a','order-a','Too late','allocated',1,1,1,'USD')
    """), "REGISTRATION_ORDER_CLOSED")

    # A separate order with an internal shipment missing invoice data cannot
    # reserve outside capacity until the invoice and currency are supplied.
    db.execute("""
      INSERT INTO registration_orders
      (id, organization_id, order_number, status, value_amount, currency,
       client_id, net_weight_kg, gross_weight_kg, is_closed, created_at, updated_at)
      VALUES ('order-b','org-a','67890','received',100,'USD',
              'client-a',100,110,0,'2026-01-01','2026-01-01')
    """)
    db.execute("""
      INSERT INTO shipments
      (id, organization_id, registration_order_id, client_id, net_weight_kg, gross_weight_kg)
      VALUES ('shipment-b','org-a','order-b','client-a',20,22)
    """)
    expect_integrity(lambda: db.execute("""
      INSERT INTO registration_order_external_allocations
      (id, organization_id, registration_order_id, recipient_company, status,
       net_weight_kg, gross_weight_kg, value_amount, currency)
      VALUES ('alloc-missing-invoice','org-a','order-b','Waiting invoice','allocated',10,11,10,'USD')
    """), "REGISTRATION_ORDER_SHIPMENT_VALUE_INCOMPLETE")

    # A linked shipment's owner cannot be changed through the master record.
    expect_integrity(lambda: db.execute("""
      UPDATE registration_orders SET client_id='client-b'
      WHERE id='order-a' AND organization_id='org-a'
    """), "REGISTRATION_ORDER_CLIENT_CONFLICT")

    print("SQLite D1 registration-order migration checks passed.")
    db.close()

if __name__ == "__main__":
    main()
