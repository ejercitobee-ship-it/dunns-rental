-- Junction table: one calendar event can be assigned to many properties.
-- The original property_id column stays for backwards compatibility and is
-- treated as the "primary" property; this table holds all assignments.
CREATE TABLE IF NOT EXISTS calendar_event_properties (
  event_id TEXT NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
  property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  PRIMARY KEY (event_id, property_id)
);

CREATE INDEX IF NOT EXISTS idx_cep_property ON calendar_event_properties(property_id);

-- Seed the junction table from any existing events that already have a property.
INSERT OR IGNORE INTO calendar_event_properties (event_id, property_id)
SELECT id, property_id FROM calendar_events WHERE property_id IS NOT NULL;
