import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, getSessionUser, jsonOk, jsonError, serverError } from '../../lib/session';

const CAN_VIEW = new Set(['super_admin', 'admin']);

/**
 * GET /api/activity — the footprint feed, newest first. Admins and Super Admins
 * only, since it is oversight of the whole team. Paginated by ?limit & ?offset.
 */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await getSessionUser(env, request);
  if (!auth) return jsonError('Not signed in', 401);
  if (!CAN_VIEW.has(auth.role)) return jsonError('You do not have access to the activity log', 403);

  try {
    const url = new URL(request.url);
    const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '100', 10) || 100, 1), 200);
    const offset = Math.max(parseInt(url.searchParams.get('offset') || '0', 10) || 0, 0);

    const { results } = await env.DB.prepare(
      `SELECT id, user_id, user_name, user_role, action, target_type, target_id, method, status_code, created_at
         FROM activity_log
        ORDER BY created_at DESC, rowid DESC
        LIMIT ? OFFSET ?`
    )
      .bind(limit, offset)
      .all();

    const data = (results || []).map((r) => {
      const row = r as Record<string, unknown>;
      return {
        id: row.id,
        userId: row.user_id ?? undefined,
        userName: row.user_name ?? undefined,
        userRole: row.user_role ?? undefined,
        action: row.action,
        targetType: row.target_type ?? undefined,
        targetId: row.target_id ?? undefined,
        method: row.method,
        statusCode: row.status_code ?? undefined,
        createdAt: row.created_at,
      };
    });

    return jsonOk({ success: true, data });
  } catch {
    return serverError();
  }
};
