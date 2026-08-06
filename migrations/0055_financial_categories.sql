-- Expand the financial data model for the enterprise reporting system.
-- Both expenses.category and incomes.source are plain TEXT columns, so new
-- category values need no schema change.  This migration adds the columns
-- Belle's spec requests on the incomes table (tenant link, payment method)
-- and an optional tier tag on expenses so reports can group by
-- property / unit / business level.

-- Income: link to a tenant and record how the money arrived.
ALTER TABLE incomes ADD COLUMN tenant_id TEXT REFERENCES tenants(id) ON DELETE SET NULL;
ALTER TABLE incomes ADD COLUMN payment_method TEXT;

-- Expense: optional tier for 3-level reporting (property, unit, business).
-- Not enforced; the frontend derives it from the category when missing.
ALTER TABLE expenses ADD COLUMN tier TEXT;

-- Index for quick tenant-income lookups.
CREATE INDEX IF NOT EXISTS idx_incomes_tenant ON incomes(tenant_id);
