import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, serverError } from '../../lib/session';

/**
 * GET /api/tenants/unlinked — tenants not linked to any realtor, for the
 * "link an existing tenant to a realtor" picker on the admin side.
 *
 * This is a STATIC route, which Cloudflare Pages resolves before the dynamic
 * `tenants/[id].ts`, so "unlinked" is never treated as a tenant id.
 */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requirePermission(env, request, 'tenants_edit');
  if (auth instanceof Response) return auth;

  try {
    const { results } = await env.DB.prepare(
      `SELECT id, first_name, last_name FROM tenants
        WHERE id NOT IN (SELECT tenant_id FROM tenant_realtors)
        ORDER BY last_name, first_name`
    ).all<{ id: string; first_name: string; last_name: string }>();

    return jsonOk({
      success: true,
      data: (results || []).map(r => ({ id: r.id, firstName: r.first_name, lastName: r.last_name })),
    });
  } catch {
    return serverError();
  }
};
