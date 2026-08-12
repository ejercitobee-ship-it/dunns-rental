-- Add lease type: 'fixed' (contract with end date) or 'month_to_month'.
-- Existing leases default to 'fixed' since they all have end dates.
ALTER TABLE leases ADD COLUMN lease_type TEXT DEFAULT 'fixed';
