-- Property notes: rich text notes attached to a property, with categories,
-- pinning, and file attachments stored in Google Drive.

CREATE TABLE IF NOT EXISTS property_notes (
  id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'general',
  is_pinned INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  created_by_name TEXT,
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch()),
  updated_by TEXT,
  updated_by_name TEXT
);

CREATE INDEX IF NOT EXISTS idx_property_notes_property ON property_notes(property_id);
CREATE INDEX IF NOT EXISTS idx_property_notes_category ON property_notes(category);

-- Attachments uploaded to Drive and linked to a note.
CREATE TABLE IF NOT EXISTS property_note_attachments (
  id TEXT PRIMARY KEY,
  note_id TEXT NOT NULL,
  name TEXT NOT NULL,
  drive_file_id TEXT NOT NULL,
  content_type TEXT,
  size INTEGER DEFAULT 0,
  uploaded_by TEXT,
  uploaded_by_name TEXT,
  uploaded_at INTEGER DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_note_attachments_note ON property_note_attachments(note_id);
