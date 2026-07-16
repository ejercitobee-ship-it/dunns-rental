-- Rent moves from the person to the unit's lease.
-- Destructive: drops and recreates tenants and rent_payments. Safe only while
-- both are empty (verified before running). See
-- docs/superpowers/specs/2026-07-15-lease-household-model-design.md

DROP TABLE IF EXISTS rent_payments;
DROP TABLE IF EXISTS tenants;

-- A tenancy on one unit. Owns the money, the dates and the state.
CREATE TABLE IF NOT EXISTS leases (
  id TEXT PRIMARY KEY,
  unit_id TEXT REFERENCES units(id) ON DELETE SET NULL,
  property_id TEXT REFERENCES properties(id) ON DELETE SET NULL,
  start_date TEXT,
  end_date TEXT,
  monthly_rent REAL NOT NULL DEFAULT 0,
  security_deposit REAL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'ended')),
  notes TEXT,
  user_id TEXT REFERENCES user(id),
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch())
);

-- A person. No rent, no lease dates, no status: all of that lives on the lease.
CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  notes TEXT,
  emergency_contact_name TEXT,
  emergency_contact_phone TEXT,
  emergency_contact_relationship TEXT,
  user_id TEXT REFERENCES user(id),
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch())
);

-- Who lives on which lease. Many people per lease; a person may appear on many
-- leases over time (renewal, or moving unit) and stays the same person.
CREATE TABLE IF NOT EXISTS lease_tenants (
  id TEXT PRIMARY KEY,
  lease_id TEXT NOT NULL REFERENCES leases(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  created_at INTEGER DEFAULT (unixepoch()),
  UNIQUE(lease_id, tenant_id)
);

-- Every time collection on a lease was paused, and (if it has ended) when it
-- resumed. A lease can be paused and resumed more than once over its life, so
-- this is a table of intervals rather than one field on leases: a single
-- pausedAt/resumedAt pair would let a second pause overwrite the first
-- interval and silently re-bill that gap. An open pause (resumed_at IS NULL)
-- excludes every month after paused_at, with no upper bound, until a later
-- row closes it. The whole paused month and the whole resumed month are still
-- owed, no proration, symmetric with how a lease's own start and end months
-- are always owed in full: only the months strictly between are excluded.
CREATE TABLE IF NOT EXISTS lease_pauses (
  id TEXT PRIMARY KEY,
  lease_id TEXT NOT NULL REFERENCES leases(id) ON DELETE CASCADE,
  paused_at TEXT NOT NULL,
  resumed_at TEXT,
  created_at INTEGER DEFAULT (unixepoch())
);

-- Rent is owed by the lease. paid_by_tenant_id records who the money came from.
CREATE TABLE IF NOT EXISTS rent_payments (
  id TEXT PRIMARY KEY,
  lease_id TEXT NOT NULL REFERENCES leases(id) ON DELETE CASCADE,
  paid_by_tenant_id TEXT REFERENCES tenants(id) ON DELETE SET NULL,
  amount REAL NOT NULL,
  due_date TEXT,
  paid_date TEXT,
  received_date TEXT,
  status TEXT DEFAULT 'pending',
  -- Settlement and taxable income both key on the month, so a month outside
  -- 1..12 (a typo'd CSV cell, say) would file real money where nothing counts
  -- it and it would vanish from every screen. Reject it at the door.
  month INTEGER CHECK (month BETWEEN 1 AND 12),
  year INTEGER,
  payment_method TEXT,
  uploaded_by TEXT,
  uploaded_at TEXT,
  notes TEXT,
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_leases_unit ON leases(unit_id);
CREATE INDEX IF NOT EXISTS idx_leases_status ON leases(status);
CREATE INDEX IF NOT EXISTS idx_lease_tenants_lease ON lease_tenants(lease_id);
CREATE INDEX IF NOT EXISTS idx_lease_tenants_tenant ON lease_tenants(tenant_id);
CREATE INDEX IF NOT EXISTS idx_lease_pauses_lease ON lease_pauses(lease_id);
CREATE INDEX IF NOT EXISTS idx_rent_payments_lease ON rent_payments(lease_id);
CREATE INDEX IF NOT EXISTS idx_rent_payments_period ON rent_payments(year, month);
