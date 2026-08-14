-- Tenant credit balance: a running ledger of credits per tenant.
-- Positive amount = credit given (admin adds from Tenant Profile).
-- Negative amount = credit applied to rent (deducted when recording rent).
-- Balance = SUM(amount) for a tenant.
-- When credit is applied, a matching rent_payment with type='credit' is also
-- created so the month's settlement math works as before.

CREATE TABLE IF NOT EXISTS tenant_credits (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  amount REAL NOT NULL,
  reason TEXT,
  notes TEXT,
  applied_to_payment_id TEXT,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_tenant_credits_tenant ON tenant_credits(tenant_id);
