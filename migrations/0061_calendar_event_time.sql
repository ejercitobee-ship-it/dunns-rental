-- Add optional time field to calendar events (e.g. "09:00", "14:30").
ALTER TABLE calendar_events ADD COLUMN event_time TEXT;
