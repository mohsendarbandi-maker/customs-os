#!/usr/bin/env python3
"""SQLite contract tests for multi-user Cloudflare D1 authentication sessions."""
from pathlib import Path
import sqlite3

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / "supabase/migrations-cloudflare"

db = sqlite3.connect(":memory:")
db.execute("PRAGMA foreign_keys = ON")
db.executescript("""
CREATE TABLE profiles (
  id TEXT PRIMARY KEY,
  organization_id TEXT,
  role TEXT,
  client_id TEXT,
  full_name TEXT,
  phone TEXT,
  is_active INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0, 1))
);
""")
db.executescript((MIGRATIONS / "0014_cloudflare_native_auth_credentials.sql").read_text(encoding="utf-8"))
db.executescript((MIGRATIONS / "0015_cloudflare_native_auth_sessions.sql").read_text(encoding="utf-8"))
db.executescript((MIGRATIONS / "0016_cloudflare_auth_challenges.sql").read_text(encoding="utf-8"))

def must_fail(statement, values, label):
    try:
        db.execute(statement, values)
    except sqlite3.IntegrityError:
        return
    raise AssertionError(f"expected constraint failure: {label}")

session_columns = {row[1] for row in db.execute("PRAGMA table_info(customs_os_auth_sessions)")}
assert {
    "session_id", "user_id", "token_hash", "created_at", "expires_at",
    "last_seen_at", "revoked_at", "device_label", "app_origin",
} <= session_columns

attempt_columns = {row[1] for row in db.execute("PRAGMA table_info(customs_os_auth_login_attempts)")}
assert {"ip_hash", "window_started_at", "attempts"} <= attempt_columns
challenge_columns = {row[1] for row in db.execute("PRAGMA table_info(customs_os_auth_challenges)")}
assert {"challenge_id", "user_id", "email_normalized", "purpose", "challenge_hash", "ip_hash", "created_at", "expires_at", "consumed_at"} <= challenge_columns
db.execute(
    """INSERT INTO customs_os_auth_challenges
       (challenge_id, user_id, email_normalized, purpose, challenge_hash, ip_hash, created_at, expires_at)
       VALUES (?, NULL, ?, 'login', ?, ?, ?, ?)""",
    ("550e8400-e29b-41d4-a716-446655440099", "unknown@example.test", "f" * 64, "a" * 64,
     "2026-11-26T00:00:00Z", "2026-11-26T00:02:00Z"),
)
challenge = db.execute(
    "SELECT user_id, purpose, consumed_at FROM customs_os_auth_challenges WHERE challenge_id = ?",
    ("550e8400-e29b-41d4-a716-446655440099",),
).fetchone()
assert challenge == (None, "login", None)
must_fail(
    """INSERT INTO customs_os_auth_challenges
       (challenge_id, user_id, email_normalized, purpose, challenge_hash, ip_hash, created_at, expires_at)
       VALUES (?, NULL, ?, ?, ?, ?, ?, ?)""",
    ("550e8400-e29b-41d4-a716-446655440098", "unknown@example.test", "signup", "f" * 64, "a" * 64,
     "2026-11-26T00:00:00Z", "2026-11-26T00:02:00Z"),
    "unsupported challenge purpose",
)
principal_columns = {row[1] for row in db.execute("PRAGMA table_info(customs_os_auth_principals)")}
assert {"user_id", "organization_id", "role", "client_id", "full_name", "phone", "is_active", "verified_at"} <= principal_columns

db.execute(
    "INSERT INTO profiles(id, organization_id, role, full_name, is_active) VALUES (?, ?, ?, ?, 1)",
    ("owner-1", "org-1", "owner", "مدیر سامانه"),
)
db.execute(
    """INSERT INTO customs_os_auth_credentials
       (user_id, email_normalized, password_verifier_encrypted, password_verifier_iv, password_salt)
       VALUES (?, ?, ?, ?, ?)""",
    ("owner-1", "owner@example.test", "a" * 96, "c" * 24, "b" * 64),
)
db.execute(
    """INSERT INTO customs_os_auth_principals
       (user_id, organization_id, role, full_name, is_active, verified_at)
       VALUES (?, ?, ?, ?, 1, ?)""",
    ("owner-1", "org-1", "owner", "مدیر سامانه", "2026-11-26T00:00:00Z"),
)
db.execute("INSERT INTO profiles(id) VALUES (?)", ("client-1",))
must_fail(
    """INSERT INTO customs_os_auth_principals
       (user_id, organization_id, role, full_name, is_active, verified_at)
       VALUES (?, ?, ?, ?, 1, ?)""",
    ("client-1", "org-1", "client", "مشتری", "2026-11-26T00:00:00Z"),
    "client role requires a client scope",
)
must_fail(
    """INSERT INTO customs_os_auth_principals
       (user_id, organization_id, role, full_name, is_active, verified_at)
       VALUES (?, ?, ?, ?, 1, ?)""",
    ("client-1", "org-1", "guest", "کاربر مهمان", "2026-11-26T00:00:00Z"),
    "unsupported roles are forbidden",
)
must_fail(
    """INSERT INTO customs_os_auth_principals
       (user_id, organization_id, role, client_id, full_name, is_active, verified_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)""",
    ("client-1", "org-1", "client", "client-1", "مشتری", 2, "2026-11-26T00:00:00Z"),
    "active flag must be boolean",
)
db.execute(
    """INSERT INTO customs_os_auth_principals
       (user_id, organization_id, role, client_id, full_name, is_active, verified_at)
       VALUES (?, ?, ?, ?, ?, 1, ?)""",
    ("client-1", "org-1", "client", "client-1", "مشتری", "2026-11-26T00:00:00Z"),
)

db.execute(
    """INSERT INTO customs_os_auth_sessions
       (session_id, user_id, token_hash, expires_at, device_label, app_origin)
       VALUES (?, ?, ?, ?, ?, ?)""",
    ("550e8400-e29b-41d4-a716-446655440000", "owner-1", "c" * 64,
     "2099-01-01T00:00:00Z", "iPhone · Safari", "https://darbandicommercial.ir"),
)

must_fail(
    """INSERT INTO customs_os_auth_sessions
       (session_id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)""",
    ("550e8400-e29b-41d4-a716-446655440001", "missing-user", "d" * 64, "2099-01-01T00:00:00Z"),
    "session must reference a profile and credential",
)
must_fail(
    """INSERT INTO customs_os_auth_sessions
       (session_id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)""",
    ("550e8400-e29b-41d4-a716-446655440002", "owner-1", "c" * 64, "2099-01-01T00:00:00Z"),
    "session token hash must be unique",
)
must_fail(
    "INSERT INTO customs_os_auth_login_attempts(ip_hash, window_started_at, attempts) VALUES (?, ?, ?)",
    ("x" * 64, "2026-11-26T00:00:00Z", -1),
    "negative login attempts are forbidden",
)
db.execute(
    "INSERT INTO customs_os_auth_login_attempts(ip_hash, window_started_at, attempts) VALUES (?, ?, ?)",
    ("e" * 64, "2026-11-26T00:00:00Z", 8),
)
row = db.execute(
    "SELECT attempts FROM customs_os_auth_login_attempts WHERE ip_hash = ?", ("e" * 64,)
).fetchone()
assert row == (8,)

events = db.execute(
    "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'customs_os_auth_sessions_user_active_idx'"
).fetchone()
assert events is not None

print("Cloudflare native multi-user auth session schema: PASS")
