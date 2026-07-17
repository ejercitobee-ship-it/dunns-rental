import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, serverError } from '../../lib/session';

/**
 * GET /api/realtors — the realtor-role users, for the picker that links a
 * realtor to a tenant.
 *
 * Gated on tenants_edit, the same permission that links a realtor, on purpose:
 * being able to link one must come with being able to see the list to pick
 * from. The picker used to read the full users list, which needs users_view,
 * so a manager with tenants_edit but not users_view saw an empty picker with
 * no hint why. Only id, name, and email are returned, nothing else about the
 * account.
 */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requirePermission(env, request, 'tenants_edit');
  if (auth instanceof Response) return auth;

  try {
    const { results } = await env.DB.prepare(
      `SELECT u.id, u.name, u.email
         FROM user u
         JOIN user_roles ur ON ur.user_id = u.id
        WHERE ur.role = 'realtor' AND u.is_active = 1
        ORDER BY u.name`
    ).all<{ id: string; name: string; email: string }>();

    return jsonOk({ success: true, data: results || [] });
  } catch {
    return serverError();
  }
};
