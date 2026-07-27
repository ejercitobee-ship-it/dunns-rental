import type { Env } from './session';
import { isUnitAvailable } from './units';

/** Longest allowed value for any tenant contact field. */
export const MAX_CONTACT_FIELD = 120;

/** Thrown when a realtor tries to place a tenant into a unit that is no longer available. */
export class UnitUnavailable extends Error {
  constructor() {
    super('That unit is no longer available');
    this.name = 'UnitUnavailable';
  }
}

/** Thrown when a realtor prices the rent below the unit's current rent. */
export class RentBelowFloor extends Error {
  constructor(public floor: number) {
    super(`Rent cannot be below the unit's current rent of $${floor}`);
    this.name = 'RentBelowFloor';
  }
}

/** Strict YYYY-MM-DD (no Date parsing), same rule as the leases endpoints. */
function isDateString(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

export interface LeaseDates {
  startDate: string | null;
  endDate: string | null;
}
export type LeaseDatesValidation = { ok: true; value: LeaseDates } | { ok: false; error: string };

/**
 * Validate the realtor's lease start and expiration. Start is required; end
 * defaults to one year after start when left blank, and can never fall on or
 * before the start. Pure.
 */
export function validateLeaseDates(startRaw: unknown, endRaw: unknown): LeaseDatesValidation {
  const start = typeof startRaw === 'string' ? startRaw.trim() : '';
  const end = typeof endRaw === 'string' ? endRaw.trim() : '';
  if (!start) return { ok: false, error: 'A lease start date is required' };
  if (!isDateString(start)) return { ok: false, error: 'Lease start date must be a valid date' };

  let endDate: string;
  if (end) {
    if (!isDateString(end)) return { ok: false, error: 'Lease expiration must be a valid date' };
    if (end <= start) return { ok: false, error: 'Lease expiration must be after the start date' };
    endDate = end;
  } else {
    const [y, m, d] = start.split('-');
    endDate = `${Number(y) + 1}-${m}-${d}`;
  }
  return { ok: true, value: { startDate: start, endDate } };
}

export interface TenantContactInput {
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  emergencyName: string | null;
  emergencyPhone: string | null;
  emergencyRelationship: string | null;
}
export type ContactValidation =
  | { ok: true; value: TenantContactInput }
  | { ok: false; error: string };

/** Validate and normalise a new tenant's name, contact, and emergency contact. Pure. */
export function validateTenantContact(body: {
  firstName?: unknown;
  lastName?: unknown;
  email?: unknown;
  phone?: unknown;
  emergencyName?: unknown;
  emergencyPhone?: unknown;
  emergencyRelationship?: unknown;
}): ContactValidation {
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const firstName = str(body.firstName);
  const lastName = str(body.lastName);
  const email = str(body.email);
  const phone = str(body.phone);
  const emergencyName = str(body.emergencyName);
  const emergencyPhone = str(body.emergencyPhone);
  const emergencyRelationship = str(body.emergencyRelationship);

  // Name, email, and phone are required; the emergency contact is optional.
  if (!firstName || !lastName) return { ok: false, error: 'First and last name are required' };
  if (!email) return { ok: false, error: 'Email is required' };
  if (!phone) return { ok: false, error: 'Phone is required' };

  for (const v of [firstName, lastName, email, phone, emergencyName, emergencyPhone, emergencyRelationship]) {
    if (v.length > MAX_CONTACT_FIELD) return { ok: false, error: 'A field is too long' };
  }
  return {
    ok: true,
    value: {
      firstName, lastName,
      email: email || null,
      phone: phone || null,
      emergencyName: emergencyName || null,
      emergencyPhone: emergencyPhone || null,
      emergencyRelationship: emergencyRelationship || null,
    },
  };
}

/**
 * Create a new person-only tenant and link it to a realtor in one batch. Always
 * inserts a NEW tenant (never attaches to an existing one). When `unitId` is
 * given, also create a DRAFT lease on that unit: rent copied from the unit,
 * dates and deposit blank, needs_review = 1 for Belle to finalize. The unit is
 * re-checked as available first; if it is not, throws UnitUnavailable. Returns
 * the new tenants row.
 */
export async function createTenantForRealtor(
  env: Env,
  realtorUserId: string,
  value: TenantContactInput,
  unitId?: string,
  monthlyRent?: number,
  dates?: LeaseDates
): Promise<Record<string, unknown>> {
  const tenantId = crypto.randomUUID();

  const statements = [
    env.DB.prepare(
      `INSERT INTO tenants (id, first_name, last_name, email, phone,
         emergency_contact_name, emergency_contact_phone, emergency_contact_relationship)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      tenantId, value.firstName, value.lastName, value.email, value.phone,
      value.emergencyName, value.emergencyPhone, value.emergencyRelationship
    ),
    env.DB.prepare(
      'INSERT OR IGNORE INTO tenant_realtors (id, tenant_id, realtor_user_id) VALUES (?, ?, ?)'
    ).bind(crypto.randomUUID(), tenantId, realtorUserId),
  ];

  if (unitId) {
    if (!(await isUnitAvailable(env, unitId))) throw new UnitUnavailable();
    const unit = await env.DB.prepare('SELECT property_id, monthly_rent FROM units WHERE id = ?')
      .bind(unitId).first<{ property_id: string | null; monthly_rent: number | null }>();
    const unitRent = unit?.monthly_rent ?? 0;
    // The realtor may price the rent, but never below the unit's current rent.
    // No price given falls back to the unit's rent.
    let leaseRent = unitRent;
    if (typeof monthlyRent === 'number' && monthlyRent > 0) {
      if (monthlyRent < unitRent) throw new RentBelowFloor(unitRent);
      leaseRent = monthlyRent;
    }
    const leaseId = crypto.randomUUID();
    statements.push(
      env.DB.prepare(
        `INSERT INTO leases (id, unit_id, property_id, monthly_rent, security_deposit,
           status, start_date, end_date, needs_review)
         VALUES (?, ?, ?, ?, NULL, 'active', ?, ?, 1)`
      ).bind(leaseId, unitId, unit?.property_id ?? null, leaseRent, dates?.startDate ?? null, dates?.endDate ?? null),
      env.DB.prepare(
        'INSERT OR IGNORE INTO lease_tenants (id, lease_id, tenant_id) VALUES (?, ?, ?)'
      ).bind(crypto.randomUUID(), leaseId, tenantId)
    );
  }

  await env.DB.batch(statements);
  const row = await env.DB.prepare('SELECT * FROM tenants WHERE id = ?').bind(tenantId).first();
  return row as Record<string, unknown>;
}
