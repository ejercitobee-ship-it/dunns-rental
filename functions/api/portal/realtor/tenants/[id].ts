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

    return jsonOk({ success: true, data: serializePortalTenant(row as Record<string, unknown>) });
  } catch {
    return serverError();
  }
};
