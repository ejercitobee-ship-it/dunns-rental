-- Links a realtor's user account to a tenant they placed. Belle creates these
-- by hand from the tenant's page. Access is derived from this row plus the
-- lease start date and the window rule, so nothing here stores an expiry that
-- could drift from the rule.
CREATE TABLE IF NOT EXISTS tenant_realtors (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  realtor_user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  created_at INTEGER DEFAULT (unixepoch()),
  UNIQUE(tenant_id, realtor_user_id)
);

CREATE INDEX IF NOT EXISTS idx_tenant_realtors_tenant ON tenant_realtors(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_realtors_realtor ON tenant_realtors(realtor_user_id);

-- Portal roles. Both carry an EMPTY permission list on purpose: they must not
-- reach a single management endpoint. Their access comes only from the portal
-- endpoints, which scope every query to the caller. is_system = 1 so they
-- cannot be deleted from Settings.
INSERT OR IGNORE INTO roles (id, name, description, permissions, is_system) VALUES
  ('tenant', 'Tenant', 'Portal only. Sees and edits their own information.', '[]', 1),
  ('realtor', 'Realtor', 'Portal only. Sees tenants they placed, within the access window.', '[]', 1);
