-- Agent/staff notes on tenants with full audit trail
CREATE TABLE IF NOT EXISTS tenant_notes (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES user(id),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_tenant_notes_tenant ON tenant_notes(tenant_id, created_at DESC);
