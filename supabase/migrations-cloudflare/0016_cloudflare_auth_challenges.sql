-- Migration 0016: one-time client challenge records for password proofs.
-- The PBKDF2 verifier is never stored in clear text; the Worker decrypts the
-- AES-GCM envelope with its private AUTH_PEPPER before validating HMAC proofs.

CREATE TABLE IF NOT EXISTS customs_os_auth_challenges (
  challenge_id TEXT PRIMARY KEY,
  user_id TEXT,
  email_normalized TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('login', 'password_change')),
  challenge_hash TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  CHECK (length(challenge_id) = 36),
  CHECK (length(challenge_hash) = 64),
  CHECK (length(ip_hash) = 64),
  CHECK (length(email_normalized) BETWEEN 3 AND 320),
  FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS customs_os_auth_challenges_expiry_idx
  ON customs_os_auth_challenges(expires_at, consumed_at);

CREATE INDEX IF NOT EXISTS customs_os_auth_challenges_user_purpose_idx
  ON customs_os_auth_challenges(user_id, purpose, expires_at);
