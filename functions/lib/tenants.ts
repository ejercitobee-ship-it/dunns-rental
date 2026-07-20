import type { D1PreparedStatement } from '@cloudflare/workers-types';
import type { Env } from './session';
import { deleteUserStatements } from './users';

/**
 * The lease ids on which this tenant is the ONLY occupant, given each of their
 * leases and how many tenants that lease has. A sole-occupant lease is safe to
 * delete with the tenant (it vacates the unit); a lease shared with a roommate
 * must survive so the roommate keeps their tenancy and their rent settles the
 * same. Pure, so the roommate-safety rule is unit-testable.
 */
export function soleOccupantLeaseIds(rows: { lease_id: string; tenant_count: number }[]): string[] {
  return rows.filter(r => r.tenant_count === 1).map(r => r.lease_id);
}

/**
 * The statements that fully wipe a tenant, in one FK-safe `env.DB.batch([...])`:
 *
 *  - delete their sole-occupant leases, which CASCADES that lease's
 *    rent_payments (paid and unpaid), lease_pauses, lease_tenants and
 *    household_members — the unit goes vacant and no balance remains;
 *  - delete their documents rows (documents.tenant_id has no FK, so it would
 *    otherwise dangle). The Drive FILES are untouched: only the DB rows go, so
 *    the tenant's Drive folder is left as is;
 *  - delete the tenant, which cascades any remaining lease_tenants (shared
 *    leases) and tenant_realtors, and nulls rent_payments.paid_by_tenant_id and
 *    maintenance_requests.tenant_id;
 *  - delete their portal login, if they have one.
 *
 * Shared-lease payments are deliberately kept (their payer is nulled, not the
 * row deleted) so the roommate's months stay settled.
 */
export function tenantWipeStatements(
  env: Env,
  tenantId: string,
  userId: string | null,
  soleLeaseIds: string[]
): D1PreparedStatement[] {
  const statements: D1PreparedStatement[] = [];
  if (soleLeaseIds.length) {
    const placeholders = soleLeaseIds.map(() => '?').join(',');
    statements.push(env.DB.prepare(`DELETE FROM leases WHERE id IN (${placeholders})`).bind(...soleLeaseIds));
  }
  statements.push(env.DB.prepare('DELETE FROM documents WHERE tenant_id = ?').bind(tenantId));
  statements.push(env.DB.prepare('DELETE FROM tenants WHERE id = ?').bind(tenantId));
  if (userId) statements.push(...deleteUserStatements(env, userId));
  return statements;
}
