import type { PagesFunction } from '@cloudflare/workers-types';
import {
  type Env,
  hashPassword,
  jsonOk,
  jsonError,
  serverError,
  sessionCookie,
} from '../../../../lib/session';

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  try {
    const body = (await request.json()) as { email?: string; password?: string; name?: string };
    const email = body.email?.trim().toLowerCase();
    const { password, name } = body;

    if (!email || !password || !name) {
      return jsonError('Missing required fields', 400);
    }
    if (password.length < 8) {
      return jsonError('Password must be at least 8 characters', 400);
    }

    const existingUser = await env.DB.prepare('SELECT id FROM user WHERE email = ?')
      .bind(email)
      .first();

    if (existingUser) {
      return jsonError('An account with this email already exists', 409);
    }

    const passwordHash = await hashPassword(password);
    const userId = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);

    await env.DB.prepare(
      'INSERT INTO user (id, name, email, email_verified, image, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
      .bind(userId, name, email, 0, null, now, now)
      .run();

    await env.DB.prepare(
      'INSERT INTO account (id, account_id, provider_id, user_id, password, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
      .bind(crypto.randomUUID(), email, 'credential', userId, passwordHash, now, now)
      .run();

    // The very first registered user becomes the super admin.
    const userCount = await env.DB.prepare('SELECT COUNT(*) as count FROM user').first<{ count: number }>();
    const role = userCount?.count === 1 ? 'super_admin' : 'viewer';

    await env.DB.prepare(
      'INSERT INTO user_roles (id, user_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
    )
      .bind(crypto.randomUUID(), userId, role, now, now)
      .run();

    const sessionToken = crypto.randomUUID();
    const expiresAt = now + 7 * 24 * 60 * 60;

    await env.DB.prepare(
      'INSERT INTO session (id, user_id, token, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    )
      .bind(crypto.randomUUID(), userId, sessionToken, expiresAt, now, now)
      .run();

    return jsonOk(
      {
        success: true,
        user: { id: userId, email, name, role },
      },
      200,
      { 'Set-Cookie': sessionCookie(sessionToken) }
    );
  } catch {
    return serverError();
  }
};
