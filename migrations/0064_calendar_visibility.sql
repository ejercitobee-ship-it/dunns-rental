-- Personal vs shared calendar events.
-- 'shared' = everyone sees it (default, backward compatible).
-- 'personal' = only the creator sees it.
ALTER TABLE calendar_events ADD COLUMN visibility TEXT NOT NULL DEFAULT 'shared'
  CHECK (visibility IN ('shared', 'personal'));
