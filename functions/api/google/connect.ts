import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonError } from '../../lib/session';
import { DRIVE_SCOPE } from '../../lib/google';

/**
 * GET /api/google/connect — send Belle to Google's consent screen.
 *
 * access_type=offline plus prompt=consent is what makes Google return a refresh
 * token. Without prompt=consent, a second authorisation returns none and the
 * connection silently cannot be renewed.
 *
 * state carries a random value in a short lived cookie and is checked on the
 * way back, so a stray callback cannot connect an account we did not ask for.
 */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requirePermission(env, request, 'settings_edit');
  if (auth instanceof Response) return auth;

  if (!env.GOOGLE_CLIENT_ID) return jsonError('Google is not configured', 503);

  const origin = new URL(request.url).origin;
  const state = crypto.randomUUID();

  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', env.GOOGLE_CLIENT_ID);
  url.searchParams.set('redirect_uri', `${origin}/api/google/callback`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', DRIVE_SCOPE);
  url.searchParams.set('access_type', 'offline');
  // select_account makes Google always ask which account to use. Without it,
  // Google silently picks whichever account the browser happens to be signed
  // in as, and because this app is Internal to mhdunnproperty.net, a personal
  // account gets a blunt "Access blocked: org_internal" with no hint that the
  // fix is simply to choose a different account.
  // consent is what makes Google return a refresh token: without it, a second
  // authorisation returns none and the connection can never be renewed.
  url.searchParams.set('prompt', 'select_account consent');
  url.searchParams.set('state', state);

  return new Response(null, {
    status: 302,
    headers: {
      Location: url.toString(),
      'Set-Cookie': `google_oauth_state=${state}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`,
    },
  });
};
