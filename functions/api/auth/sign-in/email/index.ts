import type { PagesFunction } from '@cloudflare/workers-types';
import {
  type Env,
  hashPassword,
  verifyPassword,
  jsonOk,
  jsonError,
  serverError,
  sessionCookie,
} from '../../../../lib/session';

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  try {
    const body = (await request.json()) as { email?: string; password?: string };
    const email = body.email?.trim().toLowerCase();
    const { password } = body;

    if (!email || !password) {
      return jsonError('Missing email or password', 400);
    }

    const user = await env.DB.prepare('SELECT id, name, email, is_active FROM user WHERE email = ?')
      .bind(email)
      .first<{ id: string; name: string; email: string; is_active: number | null }>();

    if (!user) {
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
      return jsonError('Invalid email or password', 401);
    }

    const { valid, needsUpgrade } = await verifyPassword(password, account.password);
    if (!valid) {
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
    const expiresAt = now + 7 * 24 * 60 * 60;

    await env.DB.prepare(
      'INSERT INTO session (id, user_id, token, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    )
      .bind(crypto.randomUUID(), user.id, sessionToken, expiresAt, now, now)
      .run();

    return jsonOk(
      {
        success: true,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: userRole?.role || 'viewer',
        },
        forcePasswordReset: forceReset,
      },
      200,
      { 'Set-Cookie': sessionCookie(sessionToken) }
    );
  } catch {
    return serverError();
  }
};
