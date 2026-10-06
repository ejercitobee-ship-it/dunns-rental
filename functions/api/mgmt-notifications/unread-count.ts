import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, serverError } from '../../lib/session';

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requirePermission(env, request, 'dashboard_view');
  if (auth instanceof Response) return auth;

  try {
    const row = await env.DB.prepare(
      `SELECT COUNT(*) as count FROM mgmt_notifications WHERE user_id = ? AND is_read = 0`
    ).bind(auth.id).first<{ count: number }>();

    return jsonOk({ count: row?.count || 0 });
  } catch {
    return serverError();
  }
};
