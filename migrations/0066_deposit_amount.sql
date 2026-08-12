-- Separate the security deposit (refundable) from the move-in fee (non-refundable).
-- Previously security_deposit held the move-in fee amount; now deposit_amount
-- tracks the actual security deposit. The deposit_returns table already
-- exists (migration 0058) but had no source-of-truth column for the amount
-- held -- it was receiving the move-in fee amount instead.
ALTER TABLE leases ADD COLUMN deposit_amount REAL DEFAULT 0;
ALTER TABLE leases ADD COLUMN deposit_paid INTEGER DEFAULT 0;
ALTER TABLE leases ADD COLUMN deposit_paid_date TEXT;
ALTER TABLE leases ADD COLUMN deposit_method TEXT;
