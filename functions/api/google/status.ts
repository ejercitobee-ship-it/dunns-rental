import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, serverError } from '../../lib/session';
import { isDriveConnected } from '../../lib/google';

/** GET /api/google/status — whether Drive is connected. Never returns tokens. */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requirePermission(env, request, 'settings_view');
  if (auth instanceof Response) return auth;
  try {
    return jsonOk({ success: true, data: { connected: await isDriveConnected(env) } });
  } catch {
    return serverError();
  }
};
