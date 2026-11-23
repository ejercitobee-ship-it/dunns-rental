import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, getSessionUser, jsonOk, jsonError, serverError, constantTimeStrEqual } from '../../lib/session';

/**
 * POST /api/cron/activity-cleanup — delete activity_log rows older than 6 months.
 * Called daily by the rent-reminder worker. Safe to run repeatedly.
 */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;

  const auth = request.headers.get('Authorization') || '';
  const presented = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  const cronOk = !!env.CRON_SECRET && constantTimeStrEqual(presented, env.CRON_SECRET);
  if (!cronOk) {
    const user = await getSessionUser(env, request);
    if (!user) return jsonError('Not authorized', 401);
    const canTrigger = user.role === 'super_admin' ||
      (user.permissions ? user.permissions.includes('settings_edit') : false);
    if (!canTrigger) return jsonError('Not authorized', 401);
  }

  try {
    const sixMonthsAgo = Math.floor(Date.now() / 1000) - (180 * 24 * 60 * 60);

    const { meta } = await env.DB.prepare(
      'DELETE FROM activity_log WHERE created_at < ?'
    ).bind(sixMonthsAgo).run();

    const deleted = meta?.changes ?? 0;
    return jsonOk({ success: true, deleted, cutoff: sixMonthsAgo });
  } catch (err) {
    console.error('activity-cleanup cron error:', err);
    return serverError();
  }
};
