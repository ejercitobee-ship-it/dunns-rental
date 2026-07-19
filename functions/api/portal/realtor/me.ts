import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requireUser, jsonOk, jsonError, serverError } from '../../../lib/session';
import { realtorTenantIds, serverToday } from '../../../lib/portal';

/**
 * GET /api/portal/realtor/me — the realtor's own profile (view only) plus a
 * small summary: how many tenants they have placed in total, and how many are
 * currently inside their active window. All resolved from the session id.
 */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requireUser(env, request);
  if (auth instanceof Response) return auth;
  if (auth.role !== 'realtor') return jsonError('Not a realtor account', 403);

  try {
    const profile = await env.DB.prepare('SELECT name, email, phone, image FROM user WHERE id = ?')
      .bind(auth.id)
      .first<{ name: string | null; email: string; phone: string | null; image: string | null }>();

    const placed = await env.DB.prepare('SELECT COUNT(*) AS n FROM tenant_realtors WHERE realtor_user_id = ?')
      .bind(auth.id)
      .first<{ n: number }>();

    const tenantsInWindow = (await realtorTenantIds(env, auth.id, serverToday())).length;

    return jsonOk({
      success: true,
      data: {
        profile: {
          name: profile?.name ?? null,
          email: profile?.email ?? '',
          phone: profile?.phone ?? null,
          photoUrl: profile?.image ? `/api/photo/${profile.image}` : null,
        },
        tenantsPlaced: placed?.n ?? 0,
        tenantsInWindow,
      },
    });
  } catch {
    return serverError();
  }
};
