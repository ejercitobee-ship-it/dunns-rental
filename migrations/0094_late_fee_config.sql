-- Per-lease toggle: opt tenants in to automatic late fee assessment.
ALTER TABLE leases ADD COLUMN late_fee_enabled INTEGER NOT NULL DEFAULT 0;

-- Per-property late fee policy (jurisdiction-aware defaults).
ALTER TABLE properties ADD COLUMN late_fee_amount REAL;
ALTER TABLE properties ADD COLUMN late_fee_type TEXT NOT NULL DEFAULT 'flat' CHECK(late_fee_type IN ('flat', 'percent'));
ALTER TABLE properties ADD COLUMN late_fee_grace_days INTEGER NOT NULL DEFAULT 5;
ALTER TABLE properties ADD COLUMN late_fee_jurisdiction TEXT;
