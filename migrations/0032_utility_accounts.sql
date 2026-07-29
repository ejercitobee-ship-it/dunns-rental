-- Utility accounts the landlord pays on a property (water, gas, electric).
-- These are reference records so admins can quickly encode the monthly bill as
-- a Utilities expense against the right property/unit. The bill itself still
-- lives in the expenses table; this only stores the account details.
CREATE TABLE utility_accounts (
  id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  unit_id TEXT REFERENCES units(id) ON DELETE SET NULL,
  type TEXT NOT NULL,           -- water | gas | electric
  provider TEXT,
  account_number TEXT,
  login_url TEXT,
  notes TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_utility_accounts_property ON utility_accounts(property_id);
