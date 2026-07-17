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

-- tenants.user_id means "this person's own portal login" and nothing else.
--
-- POST /api/tenants used to bind auth.id here, the STAFF MEMBER who created the
-- record, so in production every tenant row carried the same admin's id. The
-- portal resolves a tenant with `WHERE user_id = ?` and takes the first match,
-- so once tenant logins existed that would have handed someone an arbitrary
-- tenant's documents. The endpoint no longer writes it; clear what it wrote.
--
-- Only clear ids that belong to a real login, which is all of them today. A
-- genuine tenant link cannot exist yet: nothing has ever created one.
UPDATE tenants SET user_id = NULL WHERE user_id IS NOT NULL;

-- Make the "one login, one tenant" rule real rather than a comment. A UNIQUE
-- INDEX is used because SQLite cannot add a UNIQUE constraint via ALTER, and it
-- permits many NULLs, so every un-invited tenant is unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_user_id ON tenants(user_id);
