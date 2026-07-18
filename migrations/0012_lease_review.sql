-- Draft leases a realtor created by placing a tenant into a unit. Belle
-- finalizes them (sets dates, confirms rent) and the flag clears. 0 = a normal
-- finalized lease; 1 = a realtor placement awaiting review.
ALTER TABLE leases ADD COLUMN needs_review INTEGER DEFAULT 0;
