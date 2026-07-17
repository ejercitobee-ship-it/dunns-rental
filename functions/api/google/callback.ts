import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, parseCookies } from '../../lib/session';
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
 * This is a browser redirect, so it must be a GET and cannot return JSON.
 *
 * It deliberately does NOT call requirePermission, and that is not an
 * oversight. The browser arrives here via a 302 from accounts.google.com, which
 * is a cross site navigation, and the session cookie is SameSite=Strict, so the
 * browser withholds it. Any permission check here therefore fails for everyone,
 * every time, and Drive could never be connected.
 *
 * The state cookie is the authorisation instead, which is the ordinary OAuth
 * pattern. It is only ever issued by connect.ts, which DOES require
 * settings_edit; it is HttpOnly and Secure, so no script can read or forge it;
 * it is unguessable; it lives 10 minutes; and it is cleared on every exit path
 * below, so it cannot be replayed. A matching state therefore proves this
 * browser started a connect that an authorised user asked for.
 *
 * Do not "restore" the permission check here without also moving the session
 * cookie to SameSite=Lax, or connecting Drive will break.
 */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const origin = new URL(request.url).origin;

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
