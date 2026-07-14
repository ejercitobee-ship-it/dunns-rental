import type { PagesFunction } from '@cloudflare/workers-types';
import {
  type Env,
  getSessionUser,
  parseCookies,
  clearSessionCookie,
  jsonOk,
  jsonError,
  serverError,
} from '../../lib/session';

// GET /api/auth/session - return the current user, or 401 if not signed in.
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  try {
    const user = await getSessionUser(env, request);
    if (!user) {
      return jsonError('No session', 401);
    }
    return jsonOk({ success: true, user });
  } catch {
    return serverError();
  }
};

// POST /api/auth/session - sign out (kept for backwards compatibility).
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  try {
    const token = parseCookies(request)['session'];
    if (token) {
      await env.DB.prepare('DELETE FROM session WHERE token = ?').bind(token).run();
    }
    return jsonOk({ success: true }, 200, { 'Set-Cookie': clearSessionCookie() });
  } catch {
    return serverError();
  }
};
