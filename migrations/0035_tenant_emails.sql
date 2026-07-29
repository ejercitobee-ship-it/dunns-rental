-- Outbound emails the office sends a tenant from the app. Logged so the whole
-- correspondence is visible on the tenant's profile in the back office. This is
-- a record of what was sent; it never appears in the tenant portal.
CREATE TABLE tenant_emails (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sent_by_user_id TEXT,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  delivered INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_tenant_emails ON tenant_emails(tenant_id, created_at);
