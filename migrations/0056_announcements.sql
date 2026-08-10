-- Property-level announcements visible on the tenant portal + emailed individually.
CREATE TABLE IF NOT EXISTS announcements (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  body          TEXT NOT NULL,
  property_id   TEXT,                -- NULL = all properties
  created_by    TEXT NOT NULL,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at    TEXT,                 -- YYYY-MM-DD; NULL = never expires
  FOREIGN KEY (property_id) REFERENCES properties(id)
);
