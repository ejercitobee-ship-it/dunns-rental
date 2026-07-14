import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, jsonOk, serverError } from '../../lib/session';

const GENERIC_MESSAGE =
  'If an account exists with this email, you will receive password reset instructions.';

// POST /api/auth/forgot-password - request a password reset.
//
// Security note: this stores a reset token but intentionally does NOT return it
// to the caller. To complete the flow you must wire an email provider that
// sends the token to the account's email address, then have the reset page
// submit `{ token, newPassword }` to /api/auth/reset-password.
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  try {
    const body = (await request.json()) as { email?: string };
    const email = body.email?.trim().toLowerCase();

    // Always return the same generic message so we never reveal which emails
    // have accounts.
    if (!email) {
      return jsonOk({ success: true, message: GENERIC_MESSAGE });
    }

    const user = await env.DB.prepare('SELECT id FROM user WHERE email = ?')
      .bind(email)
      .first<{ id: string }>();

    if (user) {
      const resetToken = crypto.randomUUID();
      const now = Math.floor(Date.now() / 1000);
      const expiresAt = now + 60 * 60; // 1 hour

      await env.DB.prepare(
        'INSERT INTO password_reset_tokens (id, user_id, token, expires_at, created_at) VALUES (?, ?, ?, ?, ?)'
      )
        .bind(crypto.randomUUID(), user.id, resetToken, expiresAt, now)
        .run();

      // TODO: deliver `resetToken` to the user's email via your email provider.
    }

    return jsonOk({ success: true, message: GENERIC_MESSAGE });
  } catch {
    return serverError();
  }
};
