import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requireUser, jsonOk, serverError } from '../../../lib/session';
import { generateSecret, otpauthUrl } from '../../../lib/totp';

/**
 * POST /api/auth/2fa/setup — begin enabling 2FA for the signed-in user.
 * Generates a fresh secret, stores it as pending (totp_enabled stays 0 until a
 * code is confirmed), and returns the secret + otpauth URL for the QR code.
 */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requireUser(env, request);
  if (auth instanceof Response) return auth;

  try {
    const secret = generateSecret();
    // Pending: keep enabled at 0 until /enable confirms a code.
    await env.DB.prepare('UPDATE user SET totp_secret = ?, totp_enabled = 0 WHERE id = ?')
      .bind(secret, auth.id).run();

    const account = auth.email || auth.id;
    return jsonOk({ success: true, data: { secret, otpauthUrl: otpauthUrl(secret, account) } });
  } catch {
    return serverError();
  }
};
