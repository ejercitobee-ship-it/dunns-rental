-- Payment allocations: links one payment to the rent periods it covers.
-- A $12,000 payment creates ONE rent_payments row and SIX allocation rows.
-- Existing payments with no allocations fall back to their own (month, year).
CREATE TABLE IF NOT EXISTS payment_allocations (
  id TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL REFERENCES rent_payments(id) ON DELETE CASCADE,
  lease_id TEXT NOT NULL REFERENCES leases(id),
  month INTEGER NOT NULL CHECK(month BETWEEN 1 AND 12),
  year INTEGER NOT NULL,
  amount REAL NOT NULL CHECK(amount > 0),
  type TEXT NOT NULL DEFAULT 'rent' CHECK(type IN ('rent', 'late_fee')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(payment_id, lease_id, month, year, type)
);

-- Late fees: standalone charges, manually assessed, never automatic.
CREATE TABLE IF NOT EXISTS late_fees (
  id TEXT PRIMARY KEY,
  lease_id TEXT NOT NULL REFERENCES leases(id),
  tenant_id TEXT,
  property_id TEXT,
  unit_id TEXT,
  month INTEGER NOT NULL CHECK(month BETWEEN 1 AND 12),
  year INTEGER NOT NULL,
  amount REAL NOT NULL CHECK(amount > 0),
  assessed_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'outstanding'
    CHECK(status IN ('outstanding', 'paid', 'partial', 'waived')),
  waived_at INTEGER,
  waived_by TEXT,
  waive_reason TEXT,
  notes TEXT,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(lease_id, month, year)
);
