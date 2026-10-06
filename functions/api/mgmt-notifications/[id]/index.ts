import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../../lib/session';

export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'dashboard_view');
  if (auth instanceof Response) return auth;

  try {
    const id = params.id as string;
    const result = await env.DB.prepare(
      `DELETE FROM mgmt_notifications WHERE id = ? AND user_id = ?`
    ).bind(id, auth.id).run();

    if (!result.meta.changes) return jsonError('Notification not found', 404);
    return jsonOk({ success: true });
  } catch {
    return serverError();
  }
};
