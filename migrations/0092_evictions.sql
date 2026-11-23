-- Eviction tracking: stages, dates, lawyer info, and costs.

CREATE TABLE IF NOT EXISTS evictions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  lease_id TEXT REFERENCES leases(id),
  property_id TEXT REFERENCES properties(id),
  unit_id TEXT REFERENCES units(id),
  status TEXT NOT NULL DEFAULT 'notice_served'
    CHECK (status IN ('notice_served', 'filed_with_lawyer', 'court_date_set', 'judgment', 'completed', 'dismissed')),
  reason TEXT NOT NULL DEFAULT 'nonpayment'
    CHECK (reason IN ('nonpayment', 'lease_violation', 'holdover', 'other')),
  reason_notes TEXT,
  -- Key dates
  notice_served_date TEXT,
  filed_date TEXT,
  court_date TEXT,
  judgment_date TEXT,
  vacate_by_date TEXT,
  completed_date TEXT,
  -- Lawyer / case info
  lawyer_name TEXT,
  lawyer_phone TEXT,
  case_number TEXT,
  court_name TEXT,
  -- Outcome
  judgment_result TEXT CHECK (judgment_result IN ('landlord_favor', 'tenant_favor', 'settled', 'dismissed')),
  notes TEXT,
  created_by TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS eviction_costs (
  id TEXT PRIMARY KEY,
  eviction_id TEXT NOT NULL REFERENCES evictions(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  amount REAL NOT NULL,
  cost_date TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'lawyer_fee'
    CHECK (category IN ('lawyer_fee', 'filing_fee', 'service_fee', 'court_cost', 'other')),
  notes TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_evictions_tenant ON evictions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_evictions_status ON evictions(status);
CREATE INDEX IF NOT EXISTS idx_eviction_costs_eviction ON eviction_costs(eviction_id);
