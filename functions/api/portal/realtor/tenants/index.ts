import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requireUser, jsonOk, jsonError, serverError } from '../../../../lib/session';
import { realtorTenantIds, serverToday } from '../../../../lib/portal';
import { serializePortalTenant } from '../../../../lib/serializers';
import { validateTenantContact, createTenantForRealtor, UnitUnavailable } from '../../../../lib/realtorTenants';

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
    // Join each tenant to their most recent lease's unit and property, so the
    // list carries the unit number and the exact address.
    const { results } = await env.DB.prepare(
      `SELECT t.*,
              u.unit_number AS unit_number,
              p.address AS prop_address,
              p.city AS prop_city,
              p.state AS prop_state,
              p.zip_code AS prop_zip
         FROM tenants t
         LEFT JOIN leases l ON l.id = (
           SELECT l2.id FROM leases l2
             JOIN lease_tenants lt ON lt.lease_id = l2.id
            WHERE lt.tenant_id = t.id
            ORDER BY l2.start_date DESC LIMIT 1)
         LEFT JOIN units u ON u.id = l.unit_id
         LEFT JOIN properties p ON p.id = l.property_id
        WHERE t.id IN (${placeholders})
        ORDER BY t.last_name, t.first_name`
    ).bind(...ids).all();

    return jsonOk({
      success: true,
      data: (results || []).map(r => {
        const row = r as Record<string, unknown>;
        return {
          ...serializePortalTenant(row),
          unit: {
            unitNumber: (row.unit_number as string) ?? undefined,
            address: (row.prop_address as string) ?? undefined,
            city: (row.prop_city as string) ?? undefined,
            state: (row.prop_state as string) ?? undefined,
            zipCode: (row.prop_zip as string) ?? undefined,
          },
        };
      }),
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
    const body = (await request.json()) as Record<string, unknown>;
    const valid = validateTenantContact(body);
    if (!valid.ok) return jsonError(valid.error, 400);
    const unitId = typeof body.unitId === 'string' && body.unitId ? body.unitId : undefined;
    try {
      const row = await createTenantForRealtor(env, auth.id, valid.value, unitId);
      return jsonOk({ success: true, data: serializePortalTenant(row) }, 201);
    } catch (err) {
      if (err instanceof UnitUnavailable) return jsonError('That unit is no longer available', 409);
      throw err;
    }
  } catch {
    return serverError();
  }
};
