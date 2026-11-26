#!/usr/bin/env python3
"""SQLite contract tests for the Cloudflare-native per-user credential schema."""
from pathlib import Path
import sqlite3

ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "supabase/migrations-cloudflare/0014_cloudflare_native_auth_credentials.sql"

db = sqlite3.connect(":memory:")
db.execute("PRAGMA foreign_keys = ON")
db.execute("CREATE TABLE profiles (id TEXT PRIMARY KEY)")
db.executescript(MIGRATION.read_text(encoding="utf-8"))

columns = {row[1] for row in db.execute("PRAGMA table_info(customs_os_auth_credentials)")}
required = {
    "user_id", "email_normalized", "password_verifier_encrypted", "password_verifier_iv", "password_salt",
    "password_iterations", "password_version", "failed_attempts",
    "locked_until", "password_reset_required", "password_changed_at",
    "created_at", "updated_at",
}
assert required <= columns, f"missing credential columns: {sorted(required - columns)}"

db.execute("INSERT INTO profiles(id) VALUES (?)", ("owner-1",))
db.execute(
    """INSERT INTO customs_os_auth_credentials
       (user_id, email_normalized, password_verifier_encrypted, password_verifier_iv, password_salt)
       VALUES (?, ?, ?, ?, ?)""",
    ("owner-1", "owner@example.test", "a" * 96, "b" * 24, "b" * 64),
)

def must_fail(statement, values, label):
    try:
        db.execute(statement, values)
    except sqlite3.IntegrityError:
        return
    raise AssertionError(f"expected constraint failure: {label}")

must_fail(
    """INSERT INTO customs_os_auth_credentials
       (user_id, email_normalized, password_verifier_encrypted, password_verifier_iv, password_salt)
       VALUES (?, ?, ?, ?, ?)""",
    ("owner-2", "other@example.test", "a" * 96, "b" * 24, "b" * 64),
    "unknown profile foreign key",
)
db.execute("INSERT INTO profiles(id) VALUES (?)", ("owner-2",))
must_fail(
    """INSERT INTO customs_os_auth_credentials
       (user_id, email_normalized, password_verifier_encrypted, password_verifier_iv, password_salt)
       VALUES (?, ?, ?, ?, ?)""",
    ("owner-2", "OWNER@example.test", "c" * 96, "d" * 24, "d" * 64),
    "case-insensitive duplicate email",
)
must_fail(
    """INSERT INTO customs_os_auth_credentials
       (user_id, email_normalized, password_verifier_encrypted, password_verifier_iv, password_salt, password_iterations)
       VALUES (?, ?, ?, ?, ?, ?)""",
    ("owner-2", "other@example.test", "c" * 96, "d" * 24, "d" * 64, 999),
    "weak PBKDF2 iteration count",
)
must_fail(
    """INSERT INTO customs_os_auth_credentials
       (user_id, email_normalized, password_verifier_encrypted, password_verifier_iv, password_salt)
       VALUES (?, ?, ?, ?, ?)""",
    ("owner-2", "other@example.test", "short", "d" * 24, "e" * 64),
    "invalid encrypted verifier length",
)

must_fail(
    """INSERT INTO customs_os_auth_credentials
       (user_id, email_normalized, password_verifier_encrypted, password_verifier_iv, password_salt)
       VALUES (?, ?, ?, ?, ?)""",
    ("owner-2", "other@example.test", "f" * 96, "short", "e" * 64),
    "invalid AES-GCM IV length",
)

db.execute(
    "UPDATE customs_os_auth_credentials SET failed_attempts = 3, locked_until = ? WHERE user_id = ?",
    ("2099-01-01T00:00:00Z", "owner-1"),
)
row = db.execute(
    "SELECT email_normalized, password_iterations, failed_attempts, locked_until "
    "FROM customs_os_auth_credentials WHERE user_id = ?",
    ("owner-1",),
).fetchone()
assert row == ("owner@example.test", 310000, 3, "2099-01-01T00:00:00Z")

print("Cloudflare native auth credential schema: PASS")
