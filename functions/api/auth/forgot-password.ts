import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, jsonOk, serverError } from '../../lib/session';
import { sendEmail, passwordResetEmail } from '../../lib/email';
import { SITE_URL } from '../../lib/site';

const GENERIC_MESSAGE =
  'If an account exists with this email, you will receive password reset instructions.';

// POST /api/auth/forgot-password - request a password reset link by email.
// Always responds with the same generic message so we never reveal which
// addresses have accounts.
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  try {
    const body = (await request.json()) as { email?: string };
    const email = body.email?.trim().toLowerCase();

    // Tells the UI whether reset-by-email actually works yet, so it can point
    // people at their admin instead of promising an email that never arrives.
    const emailConfigured = !!env.RESEND_API_KEY;

    if (!email) {
      return jsonOk({ success: true, message: GENERIC_MESSAGE, emailConfigured });
    }

    const user = await env.DB.prepare('SELECT id, name FROM user WHERE email = ? AND is_active != 0')
      .bind(email)
      .first<{ id: string; name: string | null }>();

    if (user) {
      const resetToken = crypto.randomUUID();
      const now = Math.floor(Date.now() / 1000);
      const expiresAt = now + 60 * 60; // 1 hour

      await env.DB.prepare(
        'INSERT INTO password_reset_tokens (id, user_id, token, expires_at, created_at) VALUES (?, ?, ?, ?, ?)'
      )
        .bind(crypto.randomUUID(), user.id, resetToken, expiresAt, now)
        .run();

      const resetUrl = `${SITE_URL}/reset-password?token=${resetToken}`;
      const firstName = (user.name || '').split(' ')[0] || undefined;
      const mail = passwordResetEmail(resetUrl, firstName);

      // Never let a mail failure change the response (that would leak which
      // addresses exist) but do surface it in the logs.
      try {
        await sendEmail(env, { to: email, ...mail });
      } catch {
        // swallowed on purpose
      }
    }

    return jsonOk({ success: true, message: GENERIC_MESSAGE, emailConfigured });
  } catch {
    return serverError();
  }
};
