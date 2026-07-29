-- Prospective tenants (applicants). They have NO portal login; they only become
-- a real tenant on conversion. Their documents (application, lease to sign) are
-- linked by prospective_tenant_id on the shared documents table.
CREATE TABLE IF NOT EXISTS prospective_tenants (
  id TEXT PRIMARY KEY,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  notes TEXT,
  -- applied -> docs_sent -> signed -> converted (or rejected at any point)
  status TEXT NOT NULL DEFAULT 'applied'
    CHECK (status IN ('applied', 'docs_sent', 'signed', 'converted', 'rejected')),
  -- Secure, no-login signing link token (used by a later wave).
  sign_token TEXT,
  converted_tenant_id TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

ALTER TABLE documents ADD COLUMN prospective_tenant_id TEXT;
CREATE INDEX IF NOT EXISTS idx_documents_prospective ON documents(prospective_tenant_id);
