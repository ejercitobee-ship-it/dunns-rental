import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requireUser, jsonOk, jsonError, serverError } from '../../lib/session';
import { tenantIdForUser, serverToday } from '../../lib/portal';

/**
 * GET /api/portal/announcements — announcements visible to this tenant.
 *
 * Returns announcements that target the tenant's property (or all properties)
 * and have not expired.
 */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requireUser(env, request);
  if (auth instanceof Response) return auth;
  if (auth.role !== 'tenant') return jsonError('Not a tenant account', 403);

  try {
    const tenantId = await tenantIdForUser(env, auth.id);
    if (!tenantId) return jsonError('No tenant record is linked to this login', 404);

    // Find the property for the tenant's active lease.
    const lease = await env.DB.prepare(
      `SELECT l.property_id
         FROM leases l
         JOIN lease_tenants lt ON lt.lease_id = l.id
        WHERE lt.tenant_id = ? AND l.status != 'ended'
        ORDER BY l.start_date DESC
        LIMIT 1`
    ).bind(tenantId).first<{ property_id: string }>();

    const today = serverToday();

    // Announcements that target this property (or all properties) and haven't expired.
    const { results } = await env.DB.prepare(
      `SELECT a.id, a.title, a.body, a.created_at, a.expires_at,
              p.name AS property_name
         FROM announcements a
         LEFT JOIN properties p ON p.id = a.property_id
        WHERE (a.property_id IS NULL ${lease ? 'OR a.property_id = ?' : ''})
          AND (a.expires_at IS NULL OR a.expires_at >= ?)
        ORDER BY a.created_at DESC`
    ).bind(...(lease ? [lease.property_id, today] : [today])).all();

    return jsonOk({ success: true, data: results || [] });
  } catch {
    return serverError();
  }
};
