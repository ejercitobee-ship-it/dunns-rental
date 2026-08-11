-- Add end_time to calendar_events so events can have a duration (e.g. 09:00-11:00).
-- When end_time IS NULL, the event is point-in-time at event_time (or all-day).
ALTER TABLE calendar_events ADD COLUMN end_time TEXT;
