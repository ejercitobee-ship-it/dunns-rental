-- Two-way messaging between a tenant and the office. One thread per tenant,
-- keyed by tenant_id. sender_role says who wrote it; the read flags let each
-- side show an unread badge. A message is always read by whoever sent it.
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sender_role TEXT NOT NULL CHECK (sender_role IN ('tenant', 'office')),
  sender_user_id TEXT,
  body TEXT NOT NULL,
  read_by_office INTEGER NOT NULL DEFAULT 0,
  read_by_tenant INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_messages_tenant ON messages(tenant_id, created_at);
