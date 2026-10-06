import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../lib/session';

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requirePermission(env, request, 'dashboard_view');
  if (auth instanceof Response) return auth;

  try {
    const url = new URL(request.url);
    const filter = url.searchParams.get('filter') || 'all';
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
    const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get('limit') || '20')));
    const offset = (page - 1) * limit;

    let where = 'WHERE user_id = ?';
    const binds: unknown[] = [auth.id];

    if (filter === 'unread') {
      where += ' AND is_read = 0';
    } else if (filter !== 'all') {
      where += ' AND type = ?';
      binds.push(filter);
    }

    const countRow = await env.DB.prepare(
      `SELECT COUNT(*) as total FROM mgmt_notifications ${where}`
    ).bind(...binds).first<{ total: number }>();

    const { results } = await env.DB.prepare(
      `SELECT * FROM mgmt_notifications ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
    ).bind(...binds, limit, offset).all();

    return jsonOk({
      notifications: results || [],
      total: countRow?.total || 0,
      page,
      limit,
    });
  } catch {
    return serverError();
  }
};

export const onRequestPut: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requirePermission(env, request, 'dashboard_view');
  if (auth instanceof Response) return auth;

  try {
    const body = (await request.json()) as { action?: string };

    if (body.action === 'mark_all_read') {
      const now = Math.floor(Date.now() / 1000);
      await env.DB.prepare(
        `UPDATE mgmt_notifications SET is_read = 1, read_at = ? WHERE user_id = ? AND is_read = 0`
      ).bind(now, auth.id).run();
      return jsonOk({ success: true });
    }

    return jsonError('Invalid action', 400);
  } catch {
    return serverError();
  }
};
