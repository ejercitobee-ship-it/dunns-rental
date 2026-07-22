import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requireUser, jsonOk, serverError } from '../../../lib/session';
import { sendPushToUser } from '../../../lib/push';

/** POST /api/portal/push/test — send the caller a test notification so they can
 * confirm push works on their device. */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requireUser(env, request);
  if (auth instanceof Response) return auth;

  try {
    await sendPushToUser(env, auth.id, {
      title: 'MH Dunn Property',
      body: 'Notifications are on. This is a test.',
      url: '/portal',
    });
    return jsonOk({ success: true });
  } catch {
    return serverError();
  }
};
