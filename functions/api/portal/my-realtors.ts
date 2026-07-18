import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requireUser, jsonOk, jsonError, serverError } from '../../lib/session';
import { tenantIdForUser } from '../../lib/portal';

/**
 * GET /api/portal/my-realtors — the tenant's linked realtor(s), with contact
 * info. Always shown, with no window filter: this is just who placed them and
 * how to reach that person, so it stays visible after the realtor's 30-day
 * access window to the tenant has lapsed. Resolved from the session, never a
 * client-supplied id.
 */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requireUser(env, request);
  if (auth instanceof Response) return auth;
  if (auth.role !== 'tenant') return jsonError('Not a tenant account', 403);

  try {
    const tenantId = await tenantIdForUser(env, auth.id);
    if (!tenantId) return jsonOk({ success: true, data: [] });

    const { results } = await env.DB.prepare(
      `SELECT u.name, u.email, u.phone FROM user u
         JOIN tenant_realtors tr ON tr.realtor_user_id = u.id
        WHERE tr.tenant_id = ?
        ORDER BY u.name`
    ).bind(tenantId).all<{ name: string | null; email: string; phone: string | null }>();

    return jsonOk({
      success: true,
      data: (results || []).map(r => ({ name: r.name, email: r.email, phone: r.phone })),
    });
  } catch {
    return serverError();
  }
};
