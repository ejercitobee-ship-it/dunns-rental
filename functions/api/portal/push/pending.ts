import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requireUser, jsonOk, serverError } from '../../../lib/session';

/**
 * GET /api/portal/push/pending — the signed-in user's undelivered notifications.
 * The service worker calls this when it receives a push, shows each one, and the
 * rows are marked delivered here so they are shown once. Scoped to the caller.
 */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requireUser(env, request);
  if (auth instanceof Response) return auth;

  try {
    const { results } = await env.DB.prepare(
      'SELECT id, title, body, url FROM notifications WHERE user_id = ? AND delivered_at IS NULL ORDER BY created_at ASC LIMIT 20'
    )
      .bind(auth.id)
      .all<{ id: string; title: string; body: string | null; url: string | null }>();

    const rows = results || [];
    if (rows.length > 0) {
      await env.DB.prepare(
        `UPDATE notifications SET delivered_at = unixepoch() WHERE user_id = ? AND delivered_at IS NULL`
      )
        .bind(auth.id)
        .run();
    }

    return jsonOk({
      success: true,
      data: rows.map((r) => ({ id: r.id, title: r.title, body: r.body ?? undefined, url: r.url ?? undefined })),
    });
  } catch {
    return serverError();
  }
};
