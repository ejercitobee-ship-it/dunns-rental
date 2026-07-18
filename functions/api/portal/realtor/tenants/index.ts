import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requireUser, jsonOk, jsonError, serverError } from '../../../../lib/session';
import { realtorTenantIds, serverToday } from '../../../../lib/portal';
import { serializePortalTenant } from '../../../../lib/serializers';
import { validateTenantContact, createTenantForRealtor } from '../../../../lib/realtorTenants';

/** GET /api/portal/realtor/tenants — the realtor's tenants, inside the window. */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requireUser(env, request);
  if (auth instanceof Response) return auth;
  if (auth.role !== 'realtor') return jsonError('Not a realtor account', 403);

  try {
    const ids = await realtorTenantIds(env, auth.id, serverToday());
    if (ids.length === 0) return jsonOk({ success: true, data: [] });

    const placeholders = ids.map(() => '?').join(',');
    const { results } = await env.DB.prepare(
      `SELECT t.*,
              (SELECT u.unit_number FROM units u
                 JOIN leases l ON l.unit_id = u.id
                 JOIN lease_tenants lt ON lt.lease_id = l.id
                WHERE lt.tenant_id = t.id
                ORDER BY l.start_date DESC LIMIT 1) AS unit_number
         FROM tenants t
        WHERE t.id IN (${placeholders})
        ORDER BY t.last_name, t.first_name`
    ).bind(...ids).all();

    return jsonOk({
      success: true,
      data: (results || []).map(r => ({
        ...serializePortalTenant(r as Record<string, unknown>),
        unitNumber: (r as Record<string, unknown>).unit_number ?? undefined,
      })),
    });
  } catch {
    return serverError();
  }
};

/**
 * POST /api/portal/realtor/tenants — a realtor adds a NEW tenant, linked to
 * themselves. Always creates a fresh record (never attaches to an existing
 * tenant), so it cannot be used to reach someone else's tenant.
 */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requireUser(env, request);
  if (auth instanceof Response) return auth;
  if (auth.role !== 'realtor') return jsonError('Not a realtor account', 403);

  try {
    const valid = validateTenantContact((await request.json()) as Record<string, unknown>);
    if (!valid.ok) return jsonError(valid.error, 400);
    const row = await createTenantForRealtor(env, auth.id, valid.value);
    return jsonOk({ success: true, data: serializePortalTenant(row) }, 201);
  } catch {
    return serverError();
  }
};
