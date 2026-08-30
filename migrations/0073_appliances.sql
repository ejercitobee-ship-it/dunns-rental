-- Track major appliances per property/unit with warranty information.
CREATE TABLE IF NOT EXISTS appliances (
  id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  unit_id TEXT REFERENCES units(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  brand TEXT,
  model_number TEXT,
  serial_number TEXT,
  purchase_date TEXT,
  warranty_expiration TEXT,
  condition TEXT DEFAULT 'good',
  notes TEXT,
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_appliances_property ON appliances(property_id);
CREATE INDEX IF NOT EXISTS idx_appliances_unit ON appliances(unit_id);
