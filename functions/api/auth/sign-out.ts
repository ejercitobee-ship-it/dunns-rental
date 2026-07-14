import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, parseCookies, clearSessionCookie, jsonOk, serverError } from '../../lib/session';

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
