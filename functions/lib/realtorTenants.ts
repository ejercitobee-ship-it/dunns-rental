import type { Env } from './session';

/** Longest allowed value for any tenant contact field. */
export const MAX_CONTACT_FIELD = 120;

export interface TenantContactInput {
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
}
export type ContactValidation =
  | { ok: true; value: TenantContactInput }
  | { ok: false; error: string };

/** Validate and normalise the name and contact fields for a new tenant. Pure. */
export function validateTenantContact(body: {
  firstName?: unknown;
  lastName?: unknown;
  email?: unknown;
  phone?: unknown;
}): ContactValidation {
  const firstName = typeof body.firstName === 'string' ? body.firstName.trim() : '';
  const lastName = typeof body.lastName === 'string' ? body.lastName.trim() : '';
  if (!firstName || !lastName) return { ok: false, error: 'First and last name are required' };

  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
  for (const v of [firstName, lastName, email, phone]) {
    if (v.length > MAX_CONTACT_FIELD) return { ok: false, error: 'A field is too long' };
  }
  return { ok: true, value: { firstName, lastName, email: email || null, phone: phone || null } };
}

/**
 * Create a new person-only tenant and link it to a realtor in one batch. Always
 * inserts a NEW tenant: it never looks up an existing one, so a realtor can
 * never attach to (and thereby see) a tenant they did not create. The link's
 * created_at defaults to unixepoch(), which anchors the realtor's 30-day window
 * from now. Returns the new tenants row.
 */
export async function createTenantForRealtor(
  env: Env,
  realtorUserId: string,
  value: TenantContactInput
): Promise<Record<string, unknown>> {
  const tenantId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO tenants (id, first_name, last_name, email, phone) VALUES (?, ?, ?, ?, ?)'
    ).bind(tenantId, value.firstName, value.lastName, value.email, value.phone),
    env.DB.prepare(
      'INSERT OR IGNORE INTO tenant_realtors (id, tenant_id, realtor_user_id) VALUES (?, ?, ?)'
    ).bind(crypto.randomUUID(), tenantId, realtorUserId),
  ]);
  const row = await env.DB.prepare('SELECT * FROM tenants WHERE id = ?').bind(tenantId).first();
  return row as Record<string, unknown>;
}
