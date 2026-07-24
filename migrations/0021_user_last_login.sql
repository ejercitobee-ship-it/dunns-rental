-- When a user last signed in successfully. NULL means they have never logged
-- in, so the office can tell whether a tenant has actually accessed their
-- portal (shown as a "Verified" badge).
ALTER TABLE user ADD COLUMN last_login_at INTEGER;
