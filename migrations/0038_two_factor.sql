-- Optional two-factor authentication (TOTP) for staff/owner logins.
-- totp_secret: base32 secret (set while pending, kept once enabled).
-- totp_enabled: 1 once the user has confirmed a code.
-- backup_codes: JSON array of SHA-256 hashes of one-time recovery codes.
ALTER TABLE user ADD COLUMN totp_secret TEXT;
ALTER TABLE user ADD COLUMN totp_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE user ADD COLUMN backup_codes TEXT;
