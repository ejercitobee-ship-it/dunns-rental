-- Track maintenance requests resolved under manufacturer warranty.
ALTER TABLE maintenance_requests ADD COLUMN warranty_covered INTEGER NOT NULL DEFAULT 0;
ALTER TABLE maintenance_requests ADD COLUMN warranty_appliance_id TEXT REFERENCES appliances(id) ON DELETE SET NULL;
