-- Per-expense recovery period override for capital asset depreciation.
-- When set, the Tax Report uses this instead of the category-based default.
ALTER TABLE expenses ADD COLUMN recovery_years REAL;
