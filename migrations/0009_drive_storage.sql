-- Documents move from R2 to Google Drive. The table is recreated rather than
-- altered because r2_key is NOT NULL and meaningless now, and SQLite cannot
-- drop a NOT NULL. This is safe: production holds 0 documents, verified before
-- writing this, and R2 was never enabled so no file was ever stored.
DROP TABLE IF EXISTS documents;

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  -- The file's id in Google Drive. The bytes live in Belle's Drive.
  drive_file_id TEXT NOT NULL,
  content_type TEXT,
  size INTEGER,
  property_id TEXT,
  tenant_id TEXT,
  uploaded_by TEXT,
  created_at INTEGER DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_documents_tenant ON documents(tenant_id);
CREATE INDEX IF NOT EXISTS idx_documents_property ON documents(property_id);

-- The tenant's own folder in Drive, created on their first upload and then
-- reused. Tracked by id, so Belle can rename or move the folder freely.
ALTER TABLE tenants ADD COLUMN drive_folder_id TEXT;
