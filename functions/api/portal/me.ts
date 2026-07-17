import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requireUser, jsonOk, jsonError, serverError } from '../../lib/session';
import { tenantIdForUser, leasePauses } from '../../lib/portal';
import { serializePortalTenant, serializePortalLease, serializeUnit, serializeProperty } from '../../lib/serializers';

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
        WHERE lt.tenant_id = ? AND l.status != 'ended'
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

    return jsonOk({
      success: true,
      data: {
        tenant: serializePortalTenant(tenant as Record<string, unknown>),
        lease: lease ? serializePortalLease(lease as Record<string, unknown>) : null,
        unit: unit ? serializeUnit(unit as Record<string, unknown>) : null,
        property: property ? serializeProperty(property as Record<string, unknown>) : null,
      },
    });
  } catch {
    return serverError();
  }
};

/**
 * PUT /api/portal/me — the tenant corrects their own details.
 *
 * The column list is the whole security control here. It names only person
 * fields, so rent, unit, lease dates and notes are unreachable no matter what
 * the client sends. The row is chosen by the session, not by the body.
 */
export const onRequestPut: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requireUser(env, request);
  if (auth instanceof Response) return auth;
  if (auth.role !== 'tenant') return jsonError('Not a tenant account', 403);

  try {
    const tenantId = await tenantIdForUser(env, auth.id);
    if (!tenantId) return jsonError('No tenant record is linked to this login', 404);

    const body = (await request.json()) as Record<string, unknown>;
    if (!body.firstName || !body.lastName) {
      return jsonError('First and last name are required', 400);
    }
    const ec = (body.emergencyContact ?? {}) as Record<string, unknown>;

    await env.DB.prepare(
      `UPDATE tenants SET
         first_name = ?, last_name = ?, email = ?, phone = ?,
         emergency_contact_name = ?, emergency_contact_phone = ?,
         emergency_contact_relationship = ?, updated_at = unixepoch()
       WHERE id = ?`
    ).bind(
      body.firstName,
      body.lastName,
      body.email ?? null,
      body.phone ?? null,
      ec.name ?? null,
      ec.phone ?? null,
      ec.relationship ?? null,
      tenantId
    ).run();

    const row = await env.DB.prepare('SELECT * FROM tenants WHERE id = ?').bind(tenantId).first();
    return jsonOk({ success: true, data: serializePortalTenant(row as Record<string, unknown>) });
  } catch {
    return serverError();
  }
};
