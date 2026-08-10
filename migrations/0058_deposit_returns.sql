-- Move-out security deposit accounting.
-- Tracks the return workflow: amount held, itemized deductions, refund.
-- Illinois requires return within 30 days (5+ unit buildings) or 45 days.

CREATE TABLE IF NOT EXISTS deposit_returns (
  id               TEXT PRIMARY KEY,
  lease_id         TEXT NOT NULL,
  tenant_id        TEXT,
  property_id      TEXT,
  unit_id          TEXT,
  deposit_amount   REAL NOT NULL DEFAULT 0,
  move_out_date    TEXT NOT NULL,
  deadline_date    TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'pending',  -- pending | processing | completed | forfeited
  total_deductions REAL NOT NULL DEFAULT 0,
  refund_amount    REAL NOT NULL DEFAULT 0,
  refund_date      TEXT,
  refund_method    TEXT,  -- check | cash | ach | other
  notes            TEXT,
  created_at       INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at       INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS deposit_deductions (
  id                TEXT PRIMARY KEY,
  deposit_return_id TEXT NOT NULL REFERENCES deposit_returns(id) ON DELETE CASCADE,
  category          TEXT NOT NULL,  -- damage | unpaid_rent | cleaning | repairs | other
  description       TEXT NOT NULL,
  amount            REAL NOT NULL DEFAULT 0,
  created_at        INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_deposit_returns_lease ON deposit_returns(lease_id);
CREATE INDEX IF NOT EXISTS idx_deposit_returns_status ON deposit_returns(status);
CREATE INDEX IF NOT EXISTS idx_deposit_deductions_return ON deposit_deductions(deposit_return_id);
