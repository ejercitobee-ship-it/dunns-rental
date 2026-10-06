import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../../lib/session';

export const onRequestPut: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'dashboard_view');
  if (auth instanceof Response) return auth;

  try {
    const id = params.id as string;
    const body = (await request.json()) as { is_read?: boolean };
    const isRead = body.is_read !== false;
    const now = Math.floor(Date.now() / 1000);

    const result = await env.DB.prepare(
      `UPDATE mgmt_notifications SET is_read = ?, read_at = ? WHERE id = ? AND user_id = ?`
    ).bind(isRead ? 1 : 0, isRead ? now : null, id, auth.id).run();

    if (!result.meta.changes) return jsonError('Notification not found', 404);
    return jsonOk({ success: true });
  } catch {
    return serverError();
  }
};
