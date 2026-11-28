#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { buildShipmentFileManagerFolderStatements } from '../worker/shipments-file-manager.ts';

const database = {
  prepare(sql) {
    return {
      sql,
      values: [],
      bind(...values) {
        this.values = values;
        return this;
      },
    };
  },
};

const context = {
  shipmentId: 'shipment-a',
  organizationId: 'org-a',
  now: '2026-11-28T15:00:00.000Z',
};

const firstPass = buildShipmentFileManagerFolderStatements(database, context)
  .map(statement => ({ sql: statement.sql, values: statement.values }));
const secondPass = buildShipmentFileManagerFolderStatements(database, {
  ...context,
  now: '2026-11-28T15:01:00.000Z',
}).map(statement => ({ sql: statement.sql, values: statement.values }));
const thirdPass = buildShipmentFileManagerFolderStatements(database, {
  ...context,
  now: '2026-11-28T15:02:00.000Z',
}).map(statement => ({ sql: statement.sql, values: statement.values }));

const python = String.raw`
import json
import sqlite3
import sys

payload = json.load(sys.stdin)
first_pass = payload["firstPass"]
second_pass = payload["secondPass"]
third_pass = payload["thirdPass"]
db = sqlite3.connect(":memory:")
db.row_factory = sqlite3.Row

db.executescript("""
CREATE TABLE clients (id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, name TEXT NOT NULL);
CREATE TABLE cases (id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, client_id TEXT, customs_office_id TEXT);
CREATE TABLE shipments (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, case_id TEXT, client_id TEXT,
  customs_office_id TEXT, display_name TEXT, created_at TEXT NOT NULL
);
CREATE TABLE shipment_customs_data (shipment_id TEXT, organization_id TEXT, customs_office_id TEXT);
CREATE TABLE customs_offices (id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, name TEXT, code TEXT);
CREATE TABLE file_manager_folders (
  id TEXT PRIMARY KEY, parent_id TEXT, folder_key TEXT, folder_type TEXT, display_name TEXT,
  client_id TEXT, shipment_id TEXT, customs_office_id TEXT, is_system INTEGER,
  created_at TEXT, organization_id TEXT, relative_path TEXT
);
CREATE TABLE file_manager_files (
  id TEXT PRIMARY KEY, folder_id TEXT, shipment_id TEXT, client_id TEXT,
  original_name TEXT, relative_path TEXT, organization_id TEXT
);
CREATE TABLE customs_documents (
  id TEXT PRIMARY KEY, organization_id TEXT, shipment_id TEXT, client_id TEXT, updated_at TEXT
);
INSERT INTO clients VALUES ('client-a','org-a','بازرگانی الف');
INSERT INTO clients VALUES ('client-b','org-b','مشتری دیگر');
INSERT INTO customs_offices VALUES ('office-a','org-a','گمرک بندرعباس','1234');
INSERT INTO cases VALUES ('case-a','org-a','client-a','office-a');
INSERT INTO shipments VALUES ('shipment-a','org-a','case-a','client-a',NULL,'محموله آزمایشی','2026-11-28T14:00:00.000Z');
INSERT INTO shipments VALUES ('shipment-private','org-b',NULL,'client-b',NULL,'محموله خصوصی','2026-11-28T14:00:00.000Z');
INSERT INTO file_manager_files VALUES ('file-a',NULL,'shipment-a','legacy-client','بارنامه.pdf',NULL,'org-a');
INSERT INTO customs_documents VALUES ('doc-a','org-a','shipment-a','legacy-client','2026-11-20T00:00:00.000Z');
""")

def apply(statements):
    for statement in statements:
        db.execute(statement["sql"], statement["values"])
    db.commit()

apply(first_pass)

def one(sql, values=()):
    row = db.execute(sql, values).fetchone()
    return row[0] if row else None

root = db.execute(
    "SELECT * FROM file_manager_folders WHERE organization_id='org-a' AND folder_type='root' AND folder_key='owners-root'"
).fetchone()
assert root is not None, "owner root folder missing"
assert root["relative_path"] == "Customs OS Documents/صاحبان کالا"

client = db.execute(
    "SELECT * FROM file_manager_folders WHERE organization_id='org-a' AND folder_type='client' AND client_id='client-a'"
).fetchone()
assert client is not None, "client folder missing"
assert client["relative_path"] == "Customs OS Documents/صاحبان کالا/بازرگانی الف"

shipment = db.execute(
    "SELECT * FROM file_manager_folders WHERE organization_id='org-a' AND folder_type='shipment' AND shipment_id='shipment-a'"
).fetchone()
assert shipment is not None, "shipment folder missing"
assert shipment["display_name"] == "محموله آزمایشی — گمرک بندرعباس (1234)", shipment["display_name"]
assert shipment["customs_office_id"] == "office-a"

expected_children = {
    "accounting_finance": "حسابداری مالی",
    "shipping_docs": "اسناد حمل و کشتی",
    "purchase_docs": "پیش‌فاکتور و ثبت سفارش",
    "warehouse_receipt": "قبض انبار",
    "declaration": "اسناد گمرکی و اظهارنامه",
    "permits": "مجوزها",
    "exit": "ترخیص و درب خروج",
    "other": "سایر اسناد",
}
children = db.execute(
    "SELECT * FROM file_manager_folders WHERE organization_id='org-a' AND parent_id=?",
    (shipment["id"],),
).fetchall()
assert len(children) == 8, f"expected eight standard children, got {len(children)}"
assert {row["folder_type"]: row["display_name"] for row in children} == expected_children
assert all(row["is_system"] == 1 for row in children)

other = next(row for row in children if row["folder_type"] == "other")
db.execute("UPDATE file_manager_files SET folder_id=? WHERE id='file-a'", (other["id"],))
db.commit()

# Replaying the same ensure operation must update stable folder metadata without creating duplicates.
apply(second_pass)
assert one("SELECT COUNT(*) FROM file_manager_folders WHERE organization_id='org-a' AND folder_type='root'") == 1
assert one("SELECT COUNT(*) FROM file_manager_folders WHERE organization_id='org-a' AND folder_type='client' AND client_id='client-a'") == 1
assert one("SELECT COUNT(*) FROM file_manager_folders WHERE organization_id='org-a' AND folder_type='shipment' AND shipment_id='shipment-a'") == 1
assert one("SELECT COUNT(*) FROM file_manager_folders WHERE organization_id='org-a' AND parent_id=?", (shipment["id"],)) == 8
file = db.execute("SELECT * FROM file_manager_files WHERE id='file-a'").fetchone()
assert file["client_id"] == "client-a"
assert file["relative_path"] == other["relative_path"] + "/بارنامه.pdf", file["relative_path"]
document = db.execute("SELECT * FROM customs_documents WHERE id='doc-a'").fetchone()
assert document["client_id"] == "client-a"

# Office removal is represented as an explicit unknown-office folder label, not a stale name.
db.execute("UPDATE cases SET customs_office_id=NULL WHERE id='case-a'")
db.commit()
apply(third_pass)
shipment = db.execute(
    "SELECT * FROM file_manager_folders WHERE organization_id='org-a' AND folder_type='shipment' AND shipment_id='shipment-a'"
).fetchone()
assert shipment["display_name"] == "محموله آزمایشی — گمرک نامشخص"
assert shipment["customs_office_id"] is None

# A different organization is never given folders by this invocation.
assert one("SELECT COUNT(*) FROM file_manager_folders WHERE organization_id='org-b'") == 0
print(json.dumps({
    "ok": True,
    "statementCount": len(first_pass),
    "folders": 11,
    "children": len(expected_children),
    "idempotency": True,
    "officeRename": True,
    "fileLinksPreserved": True,
    "tenantIsolation": True,
}, ensure_ascii=False))
`;

const pyInput = JSON.stringify({ firstPass, secondPass, thirdPass });
const result = spawnSync('python3', ['-c', python], {
  input: pyInput,
  encoding: 'utf8',
});
if (result.status !== 0) {
  process.stderr.write(result.stdout || '');
  process.stderr.write(result.stderr || '');
  process.exit(result.status || 1);
}
process.stdout.write(result.stdout);
