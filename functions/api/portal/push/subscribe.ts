import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requireUser, jsonOk, jsonError, serverError } from '../../../lib/session';

/** POST /api/portal/push/subscribe — save (or refresh) a device subscription for
 * the signed-in user. Keyed by endpoint, so re-subscribing the same device just
 * updates the row. */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requireUser(env, request);
  if (auth instanceof Response) return auth;

  try {
    const body = (await request.json()) as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
    const endpoint = typeof body.endpoint === 'string' ? body.endpoint : '';
    if (!endpoint) return jsonError('Missing subscription endpoint', 400);

    await env.DB.prepare(
      `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`
    )
      .bind(crypto.randomUUID(), auth.id, endpoint, body.keys?.p256dh ?? null, body.keys?.auth ?? null)
      .run();

    return jsonOk({ success: true });
  } catch {
    return serverError();
  }
};

/** DELETE /api/portal/push/subscribe — remove a device subscription. */
export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requireUser(env, request);
  if (auth instanceof Response) return auth;

  try {
    const body = (await request.json().catch(() => ({}))) as { endpoint?: string };
    if (body.endpoint) {
      await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?')
        .bind(body.endpoint, auth.id)
        .run();
    }
    return jsonOk({ success: true });
  } catch {
    return serverError();
  }
};
