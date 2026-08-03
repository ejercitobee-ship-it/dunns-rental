-- Property management calendar events with recurrence support.
CREATE TABLE IF NOT EXISTS calendar_events (
  id TEXT PRIMARY KEY,
  property_id TEXT REFERENCES properties(id) ON DELETE CASCADE,
  unit_id TEXT REFERENCES units(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL CHECK (category IN (
    'rent_due', 'utility_due', 'mortgage', 'hoa', 'property_tax', 'insurance',
    'inspection', 'smoke_detector', 'hvac', 'pest_control', 'lawn_care', 'snow_removal', 'maintenance',
    'lease_expiration', 'lease_renewal', 'move_in', 'move_out',
    'contractor', 'vendor', 'licensing', 'city_inspection', 'custom'
  )),
  event_date TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  is_recurring INTEGER NOT NULL DEFAULT 0,
  recurrence_rule TEXT CHECK (recurrence_rule IN ('monthly', 'quarterly', 'semi_annually', 'annually')),
  completed INTEGER NOT NULL DEFAULT 0,
  completed_at INTEGER,
  notes TEXT,
  user_id TEXT REFERENCES user(id),
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_calendar_events_date ON calendar_events(event_date);
CREATE INDEX IF NOT EXISTS idx_calendar_events_property ON calendar_events(property_id);
CREATE INDEX IF NOT EXISTS idx_calendar_events_category ON calendar_events(category);
