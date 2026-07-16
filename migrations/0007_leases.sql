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
  -- The day collection was paused. Stamped when the status becomes 'paused',
  -- cleared on resume. The whole pause month is still owed, no proration;
  -- rent stops only from the month after.
  paused_at TEXT,
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
  month INTEGER,
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
CREATE INDEX IF NOT EXISTS idx_rent_payments_lease ON rent_payments(lease_id);
CREATE INDEX IF NOT EXISTS idx_rent_payments_period ON rent_payments(year, month);
