-- Business name for realtors (stored on the user row like handymen have company_name).
ALTER TABLE user ADD COLUMN company_name TEXT;

-- Office <-> realtor messaging thread, one per realtor. Mirrors handyman_messages.
CREATE TABLE realtor_messages (
  id TEXT PRIMARY KEY,
  realtor_user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  sender_role TEXT NOT NULL CHECK (sender_role IN ('office', 'realtor')),
  sender_user_id TEXT NOT NULL REFERENCES user(id),
  body TEXT,
  attachment_drive_id TEXT,
  attachment_name TEXT,
  attachment_type TEXT,
  read_by_office INTEGER NOT NULL DEFAULT 0,
  read_by_realtor INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_realtor_messages ON realtor_messages(realtor_user_id, created_at);
