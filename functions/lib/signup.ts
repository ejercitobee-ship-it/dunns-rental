import { type Env, hashPassword } from './session';

/**
 * Tenant self sign-up. A unit is "claimable" when someone the office already
 * added lives there (a tenant on a non-ended lease) and that person has no
 * portal login yet. The public sign-up page shows only the property, unit, and
 * the tenant's FIRST name; the tenant proves who they are by typing their LAST
 * name (never shown), then sets an email + password. Nothing here needs auth,
 * so it never selects or returns anything an outsider shouldn't see.
 */

export interface ClaimableUnit {
  unitId: string;
  unitNumber: string;
  propertyId: string;
  propertyName: string;
  address: string;
  firstName: string;
}

interface ClaimRow {
  unit_id: string;
  unit_number: string | null;
  property_id: string | null;
  property_name: string | null;
  address: string | null;
  tenant_id: string;
  first_name: string;
  last_name: string;
}

/** All un-registered tenants on non-ended leases, one row per person, stable order. */
async function claimRows(env: Env): Promise<ClaimRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT u.id AS unit_id, u.unit_number AS unit_number,
            p.id AS property_id, p.name AS property_name, p.address AS address,
            t.id AS tenant_id, t.first_name AS first_name, t.last_name AS last_name
       FROM units u
       JOIN leases l ON l.unit_id = u.id AND l.status != 'ended'
       JOIN lease_tenants lt ON lt.lease_id = l.id
       JOIN tenants t ON t.id = lt.tenant_id AND t.user_id IS NULL
       LEFT JOIN properties p ON p.id = u.property_id
      ORDER BY p.name, u.unit_number, t.last_name, t.first_name`
  ).all<ClaimRow>();
  return results || [];
}

/** One claimable tenant per unit (the first un-registered person), for the picker. */
export async function claimableUnits(env: Env): Promise<ClaimableUnit[]> {
  const rows = await claimRows(env);
  const seen = new Set<string>();
  const out: ClaimableUnit[] = [];
  for (const r of rows) {
    if (seen.has(r.unit_id)) continue;
    seen.add(r.unit_id);
    out.push({
      unitId: r.unit_id,
      unitNumber: r.unit_number ?? '',
      propertyId: r.property_id ?? '',
      propertyName: r.property_name ?? 'Property',
      address: r.address ?? '',
      firstName: r.first_name,
    });
  }
  return out;
}

/** The specific tenant a sign-up for this unit resolves to: the same first
 * un-registered person the picker showed. Null if the unit is not claimable. */
export async function claimableTenantForUnit(
  env: Env,
  unitId: string
): Promise<{ id: string; firstName: string; lastName: string } | null> {
  const rows = await claimRows(env);
  const row = rows.find(r => r.unit_id === unitId);
  return row ? { id: row.tenant_id, firstName: row.first_name, lastName: row.last_name } : null;
}

/**
 * Create the tenant's own portal login and attach it to their existing tenant
 * record, in one batch. Also stores the email they signed up with on the tenant
 * record when it was blank. Returns the new user id.
 */
export async function createTenantLoginForSignup(
  env: Env,
  tenantId: string,
  name: string,
  email: string,
  password: string
): Promise<string> {
  const userId = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const passwordHash = await hashPassword(password);

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO user (id, name, email, email_verified, image, is_active, created_at, updated_at)
       VALUES (?, ?, ?, 0, NULL, 1, ?, ?)`
    ).bind(userId, name, email, now, now),
    env.DB.prepare(
      'INSERT INTO account (id, account_id, provider_id, user_id, password, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(crypto.randomUUID(), email, 'credential', userId, passwordHash, now, now),
    env.DB.prepare(
      'INSERT INTO user_roles (id, user_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
    ).bind(crypto.randomUUID(), userId, 'tenant', now, now),
    // Link the login to the person and backfill their email if it was blank.
    env.DB.prepare(
      "UPDATE tenants SET user_id = ?, email = COALESCE(NULLIF(email, ''), ?), updated_at = unixepoch() WHERE id = ?"
    ).bind(userId, email, tenantId),
  ]);

  return userId;
}
