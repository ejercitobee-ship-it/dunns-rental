-- Recreate calendar_events with expanded recurrence options (daily, weekly)
-- and a reminder_hours column for configurable email reminders.

-- 1. Copy existing data into a temp table.
CREATE TABLE calendar_events_backup AS SELECT * FROM calendar_events;

-- 2. Drop the original (and its indexes).
DROP TABLE calendar_events;

-- 3. Recreate with the expanded CHECK constraint + reminder_hours.
CREATE TABLE calendar_events (
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
  recurrence_rule TEXT CHECK (recurrence_rule IN ('daily', 'weekly', 'monthly', 'quarterly', 'semi_annually', 'annually')),
  completed INTEGER NOT NULL DEFAULT 0,
  completed_at INTEGER,
  notes TEXT,
  user_id TEXT REFERENCES user(id),
  reminder_hours INTEGER,
  last_reminder_sent TEXT,
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch())
);

-- 4. Re-insert the backed-up rows (new columns default to NULL).
INSERT INTO calendar_events (
  id, property_id, unit_id, title, description, category, event_date,
  priority, is_recurring, recurrence_rule, completed, completed_at,
  notes, user_id, created_at, updated_at
)
SELECT
  id, property_id, unit_id, title, description, category, event_date,
  priority, is_recurring, recurrence_rule, completed, completed_at,
  notes, user_id, created_at, updated_at
FROM calendar_events_backup;

-- 5. Clean up.
DROP TABLE calendar_events_backup;

-- 6. Recreate indexes.
CREATE INDEX IF NOT EXISTS idx_calendar_events_date ON calendar_events(event_date);
CREATE INDEX IF NOT EXISTS idx_calendar_events_property ON calendar_events(property_id);
CREATE INDEX IF NOT EXISTS idx_calendar_events_category ON calendar_events(category);
