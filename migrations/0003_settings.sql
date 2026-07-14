-- Application settings, shared across the whole workspace.
-- Each row holds one settings group (company / rent / notifications) as a
-- JSON blob under a well-known key.
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER DEFAULT (unixepoch())
);
