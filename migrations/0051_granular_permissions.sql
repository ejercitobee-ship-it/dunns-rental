-- Per-user permission overrides: grants beyond (or independent of) their role.
-- Each row is one permission granted to one user. The server merges these
-- with the role's permissions at session load time.
CREATE TABLE IF NOT EXISTS user_permission_overrides (
  user_id TEXT NOT NULL,
  permission TEXT NOT NULL,
  granted_by TEXT,
  granted_at INTEGER DEFAULT (unixepoch()),
  PRIMARY KEY (user_id, permission)
);

CREATE INDEX IF NOT EXISTS idx_user_perm_overrides_user ON user_permission_overrides(user_id);

-- Audit log for permission changes.
CREATE TABLE IF NOT EXISTS permission_audit_log (
  id TEXT PRIMARY KEY,
  target_user_id TEXT NOT NULL,
  target_user_name TEXT,
  changed_by_id TEXT NOT NULL,
  changed_by_name TEXT,
  action TEXT NOT NULL,  -- 'grant' | 'revoke' | 'role_change'
  permission TEXT,       -- the specific permission (null for role_change)
  old_role TEXT,         -- for role_change
  new_role TEXT,         -- for role_change
  created_at INTEGER DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_perm_audit_user ON permission_audit_log(target_user_id);
CREATE INDEX IF NOT EXISTS idx_perm_audit_time ON permission_audit_log(created_at DESC);

-- Update the super_admin role's permissions to include all new granular permissions.
UPDATE roles SET permissions = '["dashboard_view","properties_view","properties_create","properties_edit","properties_delete","properties_history","units_view","units_create","units_edit","units_delete","tenants_view","tenants_create","tenants_edit","tenants_delete","tenants_archive","rents_view","rents_record","rents_edit","rents_export","finances_view","finances_expenses","finances_expenses_delete","finances_import","finances_import_merge","finances_import_rollback","finances_history","finances_capital_projects","finances_income","finances_export","leases_generate","leases_renewals","leases_history","leases_move_in","leases_terminate","leases_pause","maintenance_approve","maintenance_close","maintenance_history","documents_upload","documents_delete","documents_drive","reports_tax","reports_export","reports_edit_data","users_view","users_create","users_edit","users_delete","users_roles","users_permissions","settings_view","settings_edit","activity_view"]'
WHERE id = 'super_admin';
