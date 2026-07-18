-- People who live in a unit, recorded as contact-only entries. NOT tenants:
-- no login, no Drive folder, no rent, cannot be invited. Attached to the lease
-- so co-tenants on one lease share a single household roster.
CREATE TABLE IF NOT EXISTS household_members (
  id TEXT PRIMARY KEY,
  lease_id TEXT NOT NULL REFERENCES leases(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT,
  relationship TEXT,
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_household_members_lease ON household_members(lease_id);
