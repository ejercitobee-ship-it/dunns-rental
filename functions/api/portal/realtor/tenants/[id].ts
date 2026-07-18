import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requireUser, jsonOk, jsonError, serverError } from '../../../../lib/session';
import { realtorTenantIds, serverToday } from '../../../../lib/portal';
import { serializePortalTenant } from '../../../../lib/serializers';

/**
 * GET /api/portal/realtor/tenants/:id
 *
 * A tenant outside the realtor's window, or never linked to them, is a 404.
 * Same shape as the document rule: do not confirm that other tenants exist.
 */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requireUser(env, request);
  if (auth instanceof Response) return auth;
  if (auth.role !== 'realtor') return jsonError('Not a realtor account', 403);

  try {
    const id = params.id as string;
    const ids = await realtorTenantIds(env, auth.id, serverToday());
    if (!ids.includes(id)) return jsonError('Tenant not found', 404);

    const row = await env.DB.prepare('SELECT * FROM tenants WHERE id = ?').bind(id).first();
    if (!row) return jsonError('Tenant not found', 404);

    // The tenant's unit and the property's exact address, from their most recent
    // lease. The realtor placed this tenant, so the address is theirs to see.
    const place = await env.DB.prepare(
      `SELECT u.unit_number, p.address, p.city, p.state, p.zip_code
         FROM leases l
         JOIN lease_tenants lt ON lt.lease_id = l.id
         LEFT JOIN units u ON u.id = l.unit_id
         LEFT JOIN properties p ON p.id = l.property_id
        WHERE lt.tenant_id = ?
        ORDER BY l.start_date DESC LIMIT 1`
    ).bind(id).first<{ unit_number: string | null; address: string | null; city: string | null; state: string | null; zip_code: string | null }>();

    const unit = place
      ? {
          unitNumber: place.unit_number ?? undefined,
          address: place.address ?? undefined,
          city: place.city ?? undefined,
          state: place.state ?? undefined,
          zipCode: place.zip_code ?? undefined,
        }
      : undefined;

    return jsonOk({ success: true, data: { ...serializePortalTenant(row as Record<string, unknown>), unit } });
  } catch {
    return serverError();
  }
};
