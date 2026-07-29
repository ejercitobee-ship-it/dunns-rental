-- Message attachments + office<->handyman (vendor) messaging.

-- One optional file attachment per tenant<->office message. The file lives in
-- the tenant's Drive folder; only the drive id + display name/type are stored.
ALTER TABLE messages ADD COLUMN attachment_drive_id TEXT;
ALTER TABLE messages ADD COLUMN attachment_name TEXT;
ALTER TABLE messages ADD COLUMN attachment_type TEXT;

-- A Drive folder per handyman (their "Vendor" folder), for attachments they send.
ALTER TABLE handymen ADD COLUMN drive_folder_id TEXT;

-- Office <-> handyman thread, one per handyman. Mirrors `messages`.
CREATE TABLE handyman_messages (
  id TEXT PRIMARY KEY,
  handyman_id TEXT NOT NULL REFERENCES handymen(id) ON DELETE CASCADE,
  sender_role TEXT NOT NULL CHECK (sender_role IN ('office', 'handyman')),
  sender_user_id TEXT,
  body TEXT NOT NULL DEFAULT '',
  attachment_drive_id TEXT,
  attachment_name TEXT,
  attachment_type TEXT,
  read_by_office INTEGER NOT NULL DEFAULT 0,
  read_by_handyman INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_handyman_messages ON handyman_messages(handyman_id, created_at);
