export type UserCategory = 'internal' | 'realtor' | 'tenant' | 'handyman';

/**
 * Which Users-page bucket a login belongs to, decided by its role id. Portal
 * roles (tenant, realtor, handyman) are managed in their own places: tenants on
 * the Tenants page, handymen on the Maintenance page. The Users page shows and
 * adds internal staff only, so a handyman never lands in the Internal tab.
 */
export function userCategory(roleId: string): UserCategory {
  if (roleId === 'tenant') return 'tenant';
  if (roleId === 'realtor') return 'realtor';
  if (roleId === 'handyman') return 'handyman';
  return 'internal';
}
