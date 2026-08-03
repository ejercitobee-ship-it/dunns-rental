-- Per-lease rent due day override.  NULL = use the global setting.
ALTER TABLE leases ADD COLUMN rent_due_day INTEGER;
