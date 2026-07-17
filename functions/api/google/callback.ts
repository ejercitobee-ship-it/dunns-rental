import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, parseCookies } from '../../lib/session';
import { exchangeCodeForRefreshToken } from '../../lib/google';

/** Send the user back to Settings with a short result note in the query. */
function backToSettings(origin: string, result: string): Response {
  return new Response(null, {
    status: 302,
    headers: {
      Location: `${origin}/settings?drive=${result}`,
      'Set-Cookie': 'google_oauth_state=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0',
    },
  });
}

/**
 * GET /api/google/callback — Google returns here with a one time code.
 *
 * This is a browser redirect, so it must be a GET and cannot return JSON. It
 * still demands settings_edit: the callback is what actually stores the
 * connection, so it cannot be left open to anyone who guesses the URL.
 */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const origin = new URL(request.url).origin;

  const auth = await requirePermission(env, request, 'settings_edit');
  if (auth instanceof Response) return backToSettings(origin, 'denied');

  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const cookieState = parseCookies(request).google_oauth_state;

  if (url.searchParams.get('error')) return backToSettings(origin, 'cancelled');
  if (!code) return backToSettings(origin, 'failed');
  if (!state || !cookieState || state !== cookieState) return backToSettings(origin, 'failed');

  try {
    await exchangeCodeForRefreshToken(env, code, `${origin}/api/google/callback`);
    return backToSettings(origin, 'connected');
  } catch {
    return backToSettings(origin, 'failed');
  }
};
