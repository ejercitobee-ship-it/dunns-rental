-- Brute-force protection for sign in. One row per source IP tracks recent
-- failed attempts; after too many within a window the IP is locked out for a
-- cooling-off period. Keyed on IP (not email) so an attacker can only lock
-- their own address, never a real tenant's account.
CREATE TABLE IF NOT EXISTS login_throttle (
  ip TEXT PRIMARY KEY,
  fail_count INTEGER NOT NULL DEFAULT 0,
  first_fail_at INTEGER NOT NULL,
  locked_until INTEGER
);
