-- Migration 0014: Cloudflare-native per-user authentication credentials.
-- D1 only. Additive: does not modify profiles, existing sessions, or production data.
-- PBKDF2-SHA-256 is derived in the user's browser to avoid the Workers PBKDF2
-- iteration ceiling and Free CPU budget. The derived verifier is encrypted with
-- AES-256-GCM under the Worker-only AUTH_PEPPER before it is stored in D1.
-- The raw password and plaintext derived verifier are never stored in D1.

CREATE TABLE IF NOT EXISTS customs_os_auth_credentials (
  user_id TEXT PRIMARY KEY,
  email_normalized TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_verifier_encrypted TEXT NOT NULL,
  password_verifier_iv TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_iterations INTEGER NOT NULL DEFAULT 310000
    CHECK (password_iterations = 310000),
  password_version INTEGER NOT NULL DEFAULT 1
    CHECK (password_version >= 1),
  failed_attempts INTEGER NOT NULL DEFAULT 0
    CHECK (failed_attempts >= 0),
  locked_until TEXT,
  password_reset_required INTEGER NOT NULL DEFAULT 0
    CHECK (password_reset_required IN (0, 1)),
  password_changed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE RESTRICT,
  CHECK (length(email_normalized) BETWEEN 3 AND 320),
  CHECK (length(password_verifier_encrypted) = 96),
  CHECK (length(password_verifier_iv) = 24),
  CHECK (length(password_salt) = 64)
);

CREATE INDEX IF NOT EXISTS customs_os_auth_credentials_locked_idx
  ON customs_os_auth_credentials(locked_until)
  WHERE locked_until IS NOT NULL;

-- No credential is synthesized for the staging placeholder profile. An identity
-- must be imported from a verified source record or explicitly re-enrolled.
