-- The reason a tenancy ended, recorded when the office terminates a lease
-- (alongside the end date). Free text, null for leases that are still active or
-- were ended before this field existed.
ALTER TABLE leases ADD COLUMN end_reason TEXT;
