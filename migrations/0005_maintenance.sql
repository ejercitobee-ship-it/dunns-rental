-- Maintenance / work-order tracking.
CREATE TABLE IF NOT EXISTS maintenance_requests (
  id TEXT PRIMARY KEY,
  property_id TEXT REFERENCES properties(id) ON DELETE SET NULL,
  unit_id TEXT REFERENCES units(id) ON DELETE SET NULL,
  tenant_id TEXT REFERENCES tenants(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  category TEXT,                    -- plumbing, electrical, hvac, appliance, structural, general, other
  priority TEXT NOT NULL DEFAULT 'medium',  -- low, medium, high, urgent
  status TEXT NOT NULL DEFAULT 'open',       -- open, in_progress, resolved, cancelled
  cost REAL DEFAULT 0,
  vendor TEXT,
  reported_date TEXT,
  resolved_date TEXT,
  notes TEXT,
  user_id TEXT REFERENCES user(id),
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_maintenance_status ON maintenance_requests(status);
CREATE INDEX IF NOT EXISTS idx_maintenance_property ON maintenance_requests(property_id);
