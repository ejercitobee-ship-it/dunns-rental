import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requireUser, jsonOk, jsonError, serverError } from '../../lib/session';
import { tenantIdForUser, leasePauses } from '../../lib/portal';
import { getSetting } from '../../lib/google';
import { serializePortalTenant, serializePortalLease, serializeUnit, serializeProperty } from '../../lib/serializers';

const DEFAULT_PAYMENT_INSTRUCTIONS = 'Pay your rent by Zelle to 7739917112.';

/** The rent settings the portal needs: payment instructions and the past-due
 * threshold. Reads app_settings 'rent' once, falling back to defaults. */
async function rentPortalSettings(env: Env): Promise<{ paymentInstructions: string; pastDueMonths: number; rentDueDay: number }> {
  const raw = await getSetting(env, 'rent');
  let paymentInstructions = DEFAULT_PAYMENT_INSTRUCTIONS;
  let pastDueMonths = 2;
  let rentDueDay = 1;
  if (raw) {
    try {
      const r = JSON.parse(raw) as { paymentInstructions?: unknown; pastDueMonths?: unknown; rentDueDay?: unknown };
      if (typeof r.paymentInstructions === 'string' && r.paymentInstructions.trim()) {
        paymentInstructions = r.paymentInstructions;
      }
      if (typeof r.pastDueMonths === 'number' && r.pastDueMonths >= 1) {
        pastDueMonths = Math.floor(r.pastDueMonths);
      }
      if (typeof r.rentDueDay === 'number' && r.rentDueDay >= 1 && r.rentDueDay <= 31) {
        rentDueDay = Math.floor(r.rentDueDay);
      }
    } catch { /* fall through to defaults */ }
  }
  return { paymentInstructions, pastDueMonths, rentDueDay };
}

/** GET /api/portal/me — the caller's own person record, lease, unit, property. */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requireUser(env, request);
  if (auth instanceof Response) return auth;
  if (auth.role !== 'tenant') return jsonError('Not a tenant account', 403);

  try {
    const tenantId = await tenantIdForUser(env, auth.id);
    if (!tenantId) return jsonError('No tenant record is linked to this login', 404);

    const tenant = await env.DB.prepare('SELECT * FROM tenants WHERE id = ?').bind(tenantId).first();

    // The tenant's current lease: the most recent one they are on that has not
    // ended. Scoped through lease_tenants, so it can only ever be their own.
    const lease = await env.DB.prepare(
      `SELECT l.* FROM leases l
         JOIN lease_tenants lt ON lt.lease_id = l.id
        WHERE lt.tenant_id = ? AND l.status != 'ended' AND (l.needs_review IS NULL OR l.needs_review = 0)
        ORDER BY l.start_date DESC LIMIT 1`
    ).bind(tenantId).first();

    // Attach the lease's pause intervals so the tenant's pages agree with the
    // owner's Rent Management about which months were actually owed.
    if (lease) {
      (lease as Record<string, unknown>).pauses = await leasePauses(env, lease.id as string);
    }

    const unit = lease?.unit_id
      ? await env.DB.prepare('SELECT * FROM units WHERE id = ?').bind(lease.unit_id).first()
      : null;
    const property = lease?.property_id
      ? await env.DB.prepare('SELECT * FROM properties WHERE id = ?').bind(lease.property_id).first()
      : null;

    const globalSettings = await rentPortalSettings(env);
    const leaseSpecificDueDay = lease?.rent_due_day;
    return jsonOk({
      success: true,
      data: {
        tenant: serializePortalTenant(tenant as Record<string, unknown>),
        lease: lease ? serializePortalLease(lease as Record<string, unknown>) : null,
        unit: unit ? serializeUnit(unit as Record<string, unknown>) : null,
        property: property ? serializeProperty(property as Record<string, unknown>) : null,
        ...globalSettings,
        rentDueDay: typeof leaseSpecificDueDay === 'number' ? leaseSpecificDueDay : globalSettings.rentDueDay,
      },
    });
  } catch {
    return serverError();
  }
};
