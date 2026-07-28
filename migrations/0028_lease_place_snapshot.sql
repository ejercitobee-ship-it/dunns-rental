-- Snapshot of where a tenant lived, captured when the office terminates the
-- tenancy. Keeps their rental history readable even if the unit is later
-- renamed, reassigned to a new tenant, or deleted (which clears unit_id).
ALTER TABLE leases ADD COLUMN ended_property_label TEXT;
ALTER TABLE leases ADD COLUMN ended_unit_label TEXT;
