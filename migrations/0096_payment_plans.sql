-- Payment plans: structured installment agreements for tenants who cannot pay in full.
CREATE TABLE IF NOT EXISTS payment_plans (
  id TEXT PRIMARY KEY,
  lease_id TEXT NOT NULL REFERENCES leases(id),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  created_by TEXT NOT NULL REFERENCES "user"(id),
  total_amount REAL NOT NULL,
  num_installments INTEGER NOT NULL,
  start_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','completed','defaulted','cancelled')),
  reason TEXT,
  notes TEXT,
  tenant_signature_date TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS payment_plan_installments (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES payment_plans(id) ON DELETE CASCADE,
  installment_number INTEGER NOT NULL,
  due_date TEXT NOT NULL,
  amount REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','paid','missed')),
  paid_date TEXT,
  paid_amount REAL,
  notes TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_payment_plans_lease ON payment_plans(lease_id);
CREATE INDEX IF NOT EXISTS idx_payment_plans_tenant ON payment_plans(tenant_id);
CREATE INDEX IF NOT EXISTS idx_payment_plans_status ON payment_plans(status);
CREATE INDEX IF NOT EXISTS idx_plan_installments_plan ON payment_plan_installments(plan_id);
CREATE INDEX IF NOT EXISTS idx_plan_installments_due ON payment_plan_installments(due_date);
