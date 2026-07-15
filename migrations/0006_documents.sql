-- Document metadata (files themselves live in the R2 bucket bound as DOCS).
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  content_type TEXT,
  size INTEGER,
  property_id TEXT,
  tenant_id TEXT,
  uploaded_by TEXT,
  created_at INTEGER DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_documents_tenant ON documents(tenant_id);
CREATE INDEX IF NOT EXISTS idx_documents_property ON documents(property_id);
