import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, serverError } from '../../lib/session';
import { disconnectDrive } from '../../lib/google';

/**
 * POST /api/google/disconnect — forget the connection.
 * Files already in Drive are left where they are: they are Belle's.
 */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requirePermission(env, request, 'settings_edit');
  if (auth instanceof Response) return auth;
  try {
    await disconnectDrive(env);
    return jsonOk({ success: true });
  } catch {
    return serverError();
  }
};
