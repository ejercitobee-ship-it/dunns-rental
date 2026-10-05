import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, serverError } from '../../lib/session';

/**
 * GET /api/realtor-messages — the office's realtor inbox: one row per active
 * realtor with the last message, its time, and the office's unread count.
 * `?count=1` returns only the total unread across all realtor threads.
 */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requirePermission(env, request, 'tenants_view');
  if (auth instanceof Response) return auth;

  try {
    const url = new URL(request.url);
    if (url.searchParams.get('count') === '1') {
      const row = await env.DB.prepare(
        `SELECT COUNT(*) AS n FROM realtor_messages WHERE sender_role = 'realtor' AND read_by_office = 0`
      ).first<{ n: number }>();
      return jsonOk({ success: true, data: { count: row?.n ?? 0 } });
    }

    const { results } = await env.DB.prepare(
      `SELECT
         u.id AS realtorUserId,
         u.name AS name,
         u.phone AS phone,
         u.company_name AS companyName,
         (SELECT body FROM realtor_messages WHERE realtor_user_id = u.id ORDER BY created_at DESC LIMIT 1) AS lastBody,
         (SELECT sender_role FROM realtor_messages WHERE realtor_user_id = u.id ORDER BY created_at DESC LIMIT 1) AS lastSender,
         (SELECT MAX(created_at) FROM realtor_messages WHERE realtor_user_id = u.id) AS lastAt,
         (SELECT COUNT(*) FROM realtor_messages WHERE realtor_user_id = u.id AND sender_role = 'realtor' AND read_by_office = 0) AS unread
       FROM user u
       JOIN user_roles ur ON ur.user_id = u.id
       WHERE ur.role = 'realtor' AND u.is_active = 1
       ORDER BY lastAt IS NULL, lastAt DESC, u.name`
    ).all();

    return jsonOk({ success: true, data: { threads: results || [] } });
  } catch {
    return serverError();
  }
};
