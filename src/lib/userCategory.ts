export type UserCategory = 'internal' | 'realtor' | 'tenant';

/** Which Users-page tab a login belongs to, decided by its role id. */
export function userCategory(roleId: string): UserCategory {
  if (roleId === 'tenant') return 'tenant';
  if (roleId === 'realtor') return 'realtor';
  return 'internal';
}
