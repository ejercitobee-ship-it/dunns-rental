// Server-side mirror of the role -> permission map defined in
// src/types/auth.ts. Kept here (rather than imported) because Cloudflare Pages
// Functions are bundled separately from the React app. If you change a system
// role's permissions, update both places.

export const ALL_PERMISSIONS = [
  'dashboard_view',
  'properties_view', 'properties_create', 'properties_edit', 'properties_delete', 'properties_history',
  'units_view', 'units_create', 'units_edit', 'units_delete',
  'tenants_view', 'tenants_create', 'tenants_edit', 'tenants_delete', 'tenants_archive',
  'rents_view', 'rents_record', 'rents_edit', 'rents_export',
  'finances_view', 'finances_expenses', 'finances_expenses_delete', 'finances_import',
  'finances_import_merge', 'finances_import_rollback', 'finances_history',
  'finances_capital_projects', 'finances_income', 'finances_export',
  'leases_generate', 'leases_renewals', 'leases_history', 'leases_move_in',
  'leases_terminate', 'leases_pause',
  'maintenance_approve', 'maintenance_close', 'maintenance_history',
  'documents_upload', 'documents_delete', 'documents_drive',
  'reports_tax', 'reports_export', 'reports_edit_data',
  'users_view', 'users_create', 'users_edit', 'users_delete', 'users_roles', 'users_permissions',
  'settings_view', 'settings_edit', 'activity_view',
  'announcements_send',
] as const;

export const ROLE_PERMISSIONS: Record<string, readonly string[]> = {
  super_admin: ALL_PERMISSIONS,
  admin: [
    'dashboard_view',
    'properties_view', 'properties_create', 'properties_edit', 'properties_delete',
    'units_view', 'units_create', 'units_edit', 'units_delete',
    'tenants_view', 'tenants_create', 'tenants_edit', 'tenants_delete',
    'rents_view', 'rents_record', 'rents_edit', 'rents_export',
    'finances_view', 'finances_expenses', 'finances_income', 'finances_export',
    'settings_view',
  ],
  manager: [
    'dashboard_view',
    'properties_view', 'properties_create', 'properties_edit',
    'units_view', 'units_create', 'units_edit',
    'tenants_view', 'tenants_create', 'tenants_edit',
    'rents_view', 'rents_record',
    'finances_view', 'finances_expenses', 'finances_income',
  ],
  accountant: [
    'dashboard_view',
    'properties_view', 'units_view', 'tenants_view',
    'rents_view', 'rents_record', 'rents_export',
    'finances_view', 'finances_expenses', 'finances_income', 'finances_export',
  ],
  viewer: [
    'dashboard_view', 'properties_view', 'units_view', 'tenants_view',
    'rents_view', 'finances_view',
  ],
};

/** True if the given role grants the permission. Unknown roles get nothing. */
export function roleCan(role: string, permission: string): boolean {
  const perms = ROLE_PERMISSIONS[role];
  return perms ? perms.includes(permission) : false;
}
