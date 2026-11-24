-- Migration 0005: Cloudflare staging device-session management.
-- Additive only. Existing session token hashes remain unchanged.
-- Legacy active sessions receive opaque identifiers so they can be listed/revoked.
-- The migration runs only through the isolated Staging Wrangler migration workflow.

ALTER TABLE customs_admin_sessions ADD COLUMN session_id TEXT;
ALTER TABLE customs_admin_sessions ADD COLUMN device_label TEXT;
ALTER TABLE customs_admin_sessions ADD COLUMN app_origin TEXT;
ALTER TABLE customs_admin_sessions ADD COLUMN last_seen_at TEXT;
ALTER TABLE customs_admin_sessions ADD COLUMN revoked_at TEXT;

UPDATE customs_admin_sessions
SET session_id = lower(substr(hex(randomblob(4)), 1, 8) || '-' || substr(hex(randomblob(2)), 1, 4) || '-4' || substr(hex(randomblob(2)), 2, 3) || '-' || substr('89ab', abs(random() % 4) + 1, 1) || substr(hex(randomblob(2)), 2, 3) || '-' || hex(randomblob(6))),
    device_label = COALESCE(device_label, 'دستگاه قبلی'),
    last_seen_at = COALESCE(last_seen_at, created_at)
WHERE session_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS customs_admin_sessions_session_id_unique_idx
  ON customs_admin_sessions(session_id)
  WHERE session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS customs_admin_sessions_user_active_idx
  ON customs_admin_sessions(user_id, revoked_at, expires_at, created_at DESC);

CREATE TABLE IF NOT EXISTS customs_os_auth_events (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT NOT NULL,
  target_user_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (
    event_type IN ('login', 'logout', 'session_revoked', 'other_sessions_revoked')
  ),
  session_id TEXT,
  request_id TEXT,
  details_json TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS customs_os_auth_events_user_created_idx
  ON customs_os_auth_events(target_user_id, created_at DESC);
