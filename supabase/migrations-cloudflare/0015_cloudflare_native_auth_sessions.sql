-- Migration 0015: multi-user Cloudflare D1 sessions and login throttling.
-- Additive only. This is a schema foundation; it does not create users, credentials,
-- production bindings, or live sessions. Apply only after the D1 identity/profile
-- contract has been reconciled with the source profile records.

CREATE TABLE IF NOT EXISTS customs_os_auth_principals (
  user_id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'broker', 'accountant', 'warehouse', 'client')),
  client_id TEXT,
  full_name TEXT NOT NULL DEFAULT '',
  phone TEXT,
  is_active INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0, 1)),
  verified_at TEXT,
  source_profile_updated_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE RESTRICT,
  CHECK (role <> 'client' OR client_id IS NOT NULL),
  CHECK (verified_at IS NULL OR length(verified_at) >= 20)
);

CREATE INDEX IF NOT EXISTS customs_os_auth_principals_org_role_idx
  ON customs_os_auth_principals(organization_id, role, is_active);

CREATE INDEX IF NOT EXISTS customs_os_auth_principals_client_idx
  ON customs_os_auth_principals(client_id)
  WHERE client_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS customs_os_auth_sessions (
  session_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at TEXT NOT NULL,
  last_seen_at TEXT,
  revoked_at TEXT,
  device_label TEXT,
  app_origin TEXT,
  CHECK (length(session_id) = 36),
  CHECK (length(token_hash) = 64),
  FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE RESTRICT,
  FOREIGN KEY (user_id) REFERENCES customs_os_auth_credentials(user_id) ON DELETE RESTRICT,
  FOREIGN KEY (user_id) REFERENCES customs_os_auth_principals(user_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS customs_os_auth_sessions_user_active_idx
  ON customs_os_auth_sessions(user_id, revoked_at, expires_at, created_at DESC);

CREATE INDEX IF NOT EXISTS customs_os_auth_sessions_expiry_idx
  ON customs_os_auth_sessions(expires_at)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS customs_os_auth_login_attempts (
  ip_hash TEXT PRIMARY KEY,
  window_started_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0 AND attempts <= 100),
  CHECK (length(ip_hash) = 64)
);

CREATE TABLE IF NOT EXISTS customs_os_auth_audit_events (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT NOT NULL,
  target_user_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (
    event_type IN ('login', 'logout', 'session_revoked', 'other_sessions_revoked', 'password_changed')
  ),
  session_id TEXT,
  request_id TEXT,
  details_json TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS customs_os_auth_audit_events_user_created_idx
  ON customs_os_auth_audit_events(target_user_id, created_at DESC);
