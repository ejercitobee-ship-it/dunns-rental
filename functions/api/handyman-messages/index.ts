import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, serverError } from '../../lib/session';

/**
 * GET /api/handyman-messages — the office's vendor inbox: one row per ACTIVE
 * handyman (so the office can start a thread with any of them), with the last
 * message, its time, and the office's unread count. `?count=1` returns only the
 * total unread across all vendor threads (nav badge).
 */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requirePermission(env, request, 'properties_view');
  if (auth instanceof Response) return auth;

  try {
    const url = new URL(request.url);
    if (url.searchParams.get('count') === '1') {
      const row = await env.DB.prepare(
        `SELECT COUNT(*) AS n FROM handyman_messages WHERE sender_role = 'handyman' AND read_by_office = 0`
      ).first<{ n: number }>();
      return jsonOk({ success: true, data: { count: row?.n ?? 0 } });
    }

    const { results } = await env.DB.prepare(
      `SELECT
         h.id AS handymanId,
         h.name AS name,
         h.phone AS phone,
         (SELECT body FROM handyman_messages WHERE handyman_id = h.id ORDER BY created_at DESC LIMIT 1) AS lastBody,
         (SELECT sender_role FROM handyman_messages WHERE handyman_id = h.id ORDER BY created_at DESC LIMIT 1) AS lastSender,
         (SELECT MAX(created_at) FROM handyman_messages WHERE handyman_id = h.id) AS lastAt,
         (SELECT COUNT(*) FROM handyman_messages WHERE handyman_id = h.id AND sender_role = 'handyman' AND read_by_office = 0) AS unread
       FROM handymen h
       WHERE h.is_active = 1
       ORDER BY lastAt IS NULL, lastAt DESC, h.name`
    ).all();

    return jsonOk({ success: true, data: { threads: results || [] } });
  } catch {
    return serverError();
  }
};
