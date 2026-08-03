-- Track which lease renewed which, and when the renewal PDF was generated.
ALTER TABLE leases ADD COLUMN renewed_from_lease_id TEXT REFERENCES leases(id) ON DELETE SET NULL;
ALTER TABLE leases ADD COLUMN renewal_generated_at INTEGER;
ALTER TABLE leases ADD COLUMN previous_rent REAL;
