-- Roles are now stored in the database so custom roles and permission edits
-- persist and are enforced server-side. Seeded with the built-in system roles.
CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  permissions TEXT NOT NULL DEFAULT '[]', -- JSON array of permission ids
  is_system INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch())
);

INSERT OR IGNORE INTO roles (id, name, description, permissions, is_system) VALUES
  ('super_admin', 'Super Admin', 'Full access to all features and settings',
   '["dashboard_view","properties_view","properties_create","properties_edit","properties_delete","units_view","units_create","units_edit","units_delete","tenants_view","tenants_create","tenants_edit","tenants_delete","rents_view","rents_record","rents_edit","rents_export","finances_view","finances_expenses","finances_income","finances_export","users_view","users_create","users_edit","users_delete","users_roles","settings_view","settings_edit"]',
   1),
  ('admin', 'Admin', 'Can manage properties, tenants, and finances but cannot manage users',
   '["dashboard_view","properties_view","properties_create","properties_edit","properties_delete","units_view","units_create","units_edit","units_delete","tenants_view","tenants_create","tenants_edit","tenants_delete","rents_view","rents_record","rents_edit","rents_export","finances_view","finances_expenses","finances_income","finances_export","settings_view"]',
   1),
  ('manager', 'Property Manager', 'Can manage day-to-day operations but cannot delete records',
   '["dashboard_view","properties_view","properties_create","properties_edit","units_view","units_create","units_edit","tenants_view","tenants_create","tenants_edit","rents_view","rents_record","finances_view","finances_expenses","finances_income"]',
   1),
  ('accountant', 'Accountant', 'Access to financial data and rent management',
   '["dashboard_view","properties_view","units_view","tenants_view","rents_view","rents_record","rents_export","finances_view","finances_expenses","finances_income","finances_export"]',
   1),
  ('viewer', 'Viewer', 'Read-only access to view reports and data',
   '["dashboard_view","properties_view","units_view","tenants_view","rents_view","finances_view"]',
   1);

-- Extra profile fields the Users page edits.
ALTER TABLE user ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;
ALTER TABLE user ADD COLUMN phone TEXT;
ALTER TABLE user ADD COLUMN department TEXT;
