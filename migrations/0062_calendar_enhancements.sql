-- Calendar enhancements: multi-day events, user birthdate, and auto lease events.

-- 1. Add birthdate column to user table (YYYY-MM-DD format).
ALTER TABLE user ADD COLUMN birthdate TEXT;

-- 2. Add end_date to calendar_events so an event can block multiple days.
--    When end_date IS NULL, the event is a single-day event on event_date.
ALTER TABLE calendar_events ADD COLUMN end_date TEXT;

-- 3. Widen the category CHECK to include new auto and personal categories.
--    SQLite can't ALTER CHECK constraints, so we rebuild the table.
CREATE TABLE calendar_events_v3 AS SELECT * FROM calendar_events;
DROP TABLE calendar_events;

CREATE TABLE calendar_events (
  id TEXT PRIMARY KEY,
  property_id TEXT REFERENCES properties(id) ON DELETE CASCADE,
  unit_id TEXT REFERENCES units(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL CHECK (category IN (
    'rent_due', 'utility_due', 'mortgage', 'hoa', 'property_tax', 'insurance',
    'inspection', 'smoke_detector', 'hvac', 'pest_control', 'lawn_care', 'snow_removal', 'maintenance',
    'lease_expiration', 'lease_renewal', 'lease_termination', 'move_in', 'move_out',
    'contractor', 'vendor', 'licensing', 'city_inspection',
    'birthday', 'personal', 'custom'
  )),
  event_date TEXT NOT NULL,
  end_date TEXT,
  event_time TEXT,
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  is_recurring INTEGER NOT NULL DEFAULT 0,
  recurrence_rule TEXT CHECK (recurrence_rule IN ('daily', 'weekly', 'monthly', 'quarterly', 'semi_annually', 'annually')),
  completed INTEGER NOT NULL DEFAULT 0,
  completed_at INTEGER,
  notes TEXT,
  user_id TEXT REFERENCES user(id),
  reminder_hours INTEGER,
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch())
);

INSERT INTO calendar_events
SELECT id, property_id, unit_id, title, description, category,
       event_date, end_date, event_time, priority,
       is_recurring, recurrence_rule, completed, completed_at,
       notes, user_id, reminder_hours, created_at, updated_at
FROM calendar_events_v3;

DROP TABLE calendar_events_v3;

-- Restore indexes.
CREATE INDEX IF NOT EXISTS idx_calendar_events_date ON calendar_events(event_date);
CREATE INDEX IF NOT EXISTS idx_calendar_events_category ON calendar_events(category);

-- Restore the multi-property junction.
-- The FK from calendar_event_properties still references calendar_events(id),
-- and the data survived because the junction was not dropped. SQLite does not
-- re-validate FK constraints retroactively, and the ids are unchanged.
