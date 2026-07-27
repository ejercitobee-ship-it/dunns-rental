import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, serverError } from '../../lib/session';

/**
 * GET /api/messages — the office inbox: one row per tenant who has a thread,
 * newest activity first, with the last message and the office's unread count.
 * `?count=1` returns only the total unread across all threads (nav badge).
 */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requirePermission(env, request, 'tenants_view');
  if (auth instanceof Response) return auth;

  try {
    const url = new URL(request.url);
    if (url.searchParams.get('count') === '1') {
      const row = await env.DB.prepare(
        `SELECT COUNT(*) AS n FROM messages WHERE sender_role = 'tenant' AND read_by_office = 0`
      ).first<{ n: number }>();
      return jsonOk({ success: true, data: { count: row?.n ?? 0 } });
    }

    // One row per tenant thread: last message, its time, and how many of that
    // tenant's messages the office has not read yet.
    const { results } = await env.DB.prepare(
      `SELECT
         m.tenant_id AS tenantId,
         t.first_name AS firstName,
         t.last_name AS lastName,
         (SELECT body FROM messages WHERE tenant_id = m.tenant_id ORDER BY created_at DESC LIMIT 1) AS lastBody,
         (SELECT sender_role FROM messages WHERE tenant_id = m.tenant_id ORDER BY created_at DESC LIMIT 1) AS lastSender,
         MAX(m.created_at) AS lastAt,
         SUM(CASE WHEN m.sender_role = 'tenant' AND m.read_by_office = 0 THEN 1 ELSE 0 END) AS unread
       FROM messages m
       JOIN tenants t ON t.id = m.tenant_id
       GROUP BY m.tenant_id
       ORDER BY lastAt DESC`
    ).all();

    return jsonOk({ success: true, data: { threads: results || [] } });
  } catch {
    return serverError();
  }
};
