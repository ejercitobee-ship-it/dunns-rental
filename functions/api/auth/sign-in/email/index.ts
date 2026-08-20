import type { PagesFunction } from '@cloudflare/workers-types';
import {
  type Env,
  hashPassword,
  verifyPassword,
  jsonOk,
  jsonError,
  serverError,
  sessionCookie,
  parseCookies,
} from '../../../../lib/session';
import { throttleLockedUntil, recordLoginFailure, clearLoginThrottle } from '../../../../lib/throttle';
import { verifyUserTwoFactor } from '../../../../lib/two-factor';
import { issueAndSendEmailCode, verifyEmailCode, checkTrustedDevice, issueTrustedDevice, trustedDeviceCookie } from '../../../../lib/email-otp';

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  // Cloudflare gives us the real client IP; brute-force protection is keyed on it.
  const ip = request.headers.get('CF-Connecting-IP');

  try {
    const body = (await request.json()) as { email?: string; password?: string; code?: string; rememberDevice?: boolean };
    const email = body.email?.trim().toLowerCase();
    const { password } = body;

    if (!email || !password) {
      return jsonError('Missing email or password', 400);
    }

    // Refuse early if this IP has failed too many times recently.
    const locked = await throttleLockedUntil(env, ip);
    if (locked) {
      const mins = Math.max(1, Math.ceil((locked - Math.floor(Date.now() / 1000)) / 60));
      return jsonError(`Too many sign in attempts. Please try again in ${mins} minute${mins === 1 ? '' : 's'}.`, 429);
    }

    const user = await env.DB.prepare('SELECT id, name, email, is_active, totp_secret, totp_enabled, backup_codes FROM user WHERE email = ?')
      .bind(email)
      .first<{ id: string; name: string; email: string; is_active: number | null; totp_secret: string | null; totp_enabled: number | null; backup_codes: string | null }>();

    if (!user) {
      await recordLoginFailure(env, ip);
      return jsonError('Invalid email or password', 401);
    }

    if (user.is_active === 0) {
      return jsonError('This account has been deactivated', 403);
    }

    const account = await env.DB.prepare(
      'SELECT password FROM account WHERE user_id = ? AND provider_id = ?'
    )
      .bind(user.id, 'credential')
      .first<{ password: string }>();

    if (!account?.password) {
      await recordLoginFailure(env, ip);
      return jsonError('Invalid email or password', 401);
    }

    const { valid, needsUpgrade } = await verifyPassword(password, account.password);
    if (!valid) {
      await recordLoginFailure(env, ip);
      return jsonError('Invalid email or password', 401);
    }

    // Transparently upgrade legacy unsalted SHA-256 hashes to PBKDF2 on login.
    if (needsUpgrade) {
      const upgraded = await hashPassword(password);
      await env.DB.prepare(
        'UPDATE account SET password = ?, updated_at = ? WHERE user_id = ? AND provider_id = ?'
      )
        .bind(upgraded, Math.floor(Date.now() / 1000), user.id, 'credential')
        .run();
    }

    // Second factor. A device the user chose to remember (a valid td cookie)
    // needs NO code at all for 30 days, so the routine 30-minute inactivity
    // re-login never re-prompts: only a genuinely fresh login on a new or
    // long-idle device does. Otherwise the code is an authenticator-app code
    // (TOTP) if they set one up, else a one-time code emailed to them.
    let tdCookieToSet: string | null = null;
    const tdToken = parseCookies(request)['td'];
    const trustedDevice = await checkTrustedDevice(env, user.id, tdToken);

    if (trustedDevice) {
      // Remembered device within its 30-day window: skip the code.
    } else if (user.totp_enabled) {
      const code = (body.code || '').trim();
      if (!code) {
        return jsonOk({ success: false, twoFactorRequired: true, method: 'app' }, 200);
      }
      const ok = await verifyUserTwoFactor(env, user.id, user.totp_secret, user.backup_codes, code);
      if (!ok) {
        await recordLoginFailure(env, ip);
        return jsonError('Invalid authentication code', 401);
      }
      if (body.rememberDevice) tdCookieToSet = trustedDeviceCookie(await issueTrustedDevice(env, user.id));
    } else {
      const code = (body.code || '').trim();
      if (!code) {
        // Password was right; email a fresh code and ask the client for it.
        const sent = await issueAndSendEmailCode(env, user.id, user.email, user.name);
        if (!sent) {
          return jsonError('We could not send your sign-in code. Please try again or contact the office.', 503);
        }
        return jsonOk({ success: false, twoFactorRequired: true, method: 'email' }, 200);
      }
      const ok = await verifyEmailCode(env, user.id, code);
      if (!ok) {
        await recordLoginFailure(env, ip);
        return jsonError('That code is not valid or has expired. Request a new one.', 401);
      }
      if (body.rememberDevice) tdCookieToSet = trustedDeviceCookie(await issueTrustedDevice(env, user.id));
    }

    const userRole = await env.DB.prepare('SELECT role FROM user_roles WHERE user_id = ?')
      .bind(user.id)
      .first<{ role: string }>();

    let forceReset = false;
    try {
      const resetFlag = await env.DB.prepare(
        'SELECT value FROM user_metadata WHERE user_id = ? AND key = ?'
      )
        .bind(user.id, 'force_password_reset')
        .first<{ value: string }>();
      forceReset = resetFlag?.value === 'true';
    } catch {
      // user_metadata table may not exist on older databases; ignore.
    }

    const sessionToken = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + 15 * 60; // 15-minute idle timeout; renewed on every request

    await env.DB.batch([
      env.DB.prepare(
        'INSERT INTO session (id, user_id, token, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).bind(crypto.randomUUID(), user.id, sessionToken, expiresAt, now, now),
      // Stamp the successful login so the office can see a tenant has actually
      // accessed their portal (the "Verified" badge).
      env.DB.prepare('UPDATE user SET last_login_at = ? WHERE id = ?').bind(now, user.id),
    ]);

    // A good sign in clears this IP's failure streak.
    context.waitUntil(clearLoginThrottle(env, ip));

    // Two cookies may be set (session + remembered device), so build the headers
    // by hand: a plain object cannot carry two Set-Cookie entries.
    const headers = new Headers({ 'Content-Type': 'application/json' });
    headers.append('Set-Cookie', sessionCookie(sessionToken));
    if (tdCookieToSet) headers.append('Set-Cookie', tdCookieToSet);

    return new Response(
      JSON.stringify({
        success: true,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: userRole?.role || 'viewer',
        },
        forcePasswordReset: forceReset,
      }),
      { status: 200, headers }
    );
  } catch {
    return serverError();
  }
};
