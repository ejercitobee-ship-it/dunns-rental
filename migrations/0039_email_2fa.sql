-- Email-code two-factor auth, required for every login (staff, tenants, vendors)
-- unless the user uses an authenticator app (TOTP) or is on a trusted device.

-- One active login code per user (re-issuing replaces it). SHA-256 hashed.
CREATE TABLE login_codes (
  user_id TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Remembered devices: a valid, unexpired token lets that browser skip the code
-- for 30 days. The token is a random secret; only its hash is stored.
CREATE TABLE trusted_devices (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_trusted_devices_user ON trusted_devices(user_id);
