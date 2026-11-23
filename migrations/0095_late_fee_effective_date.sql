-- Add an effective date to the property late fee config so the cron
-- skips months before this date even if late_fee_enabled is already on.
ALTER TABLE properties ADD COLUMN late_fee_effective_date TEXT;
