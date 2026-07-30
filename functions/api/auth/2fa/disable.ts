import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requireUser, jsonOk, jsonError, serverError } from '../../../lib/session';
import { verifyUserTwoFactor } from '../../../lib/two-factor';

/**
 * POST /api/auth/2fa/disable — turn 2FA off. Requires a current code (TOTP or a
 * backup code) so a walk-up session cannot silently remove it. Body: { code }.
 */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requireUser(env, request);
  if (auth instanceof Response) return auth;

  try {
    const { code } = (await request.json()) as { code?: string };
    const row = await env.DB.prepare('SELECT totp_secret, totp_enabled, backup_codes FROM user WHERE id = ?')
      .bind(auth.id).first<{ totp_secret: string | null; totp_enabled: number | null; backup_codes: string | null }>();
    if (!row?.totp_enabled) return jsonError('Two-factor authentication is not enabled.', 400);

    const ok = await verifyUserTwoFactor(env, auth.id, row.totp_secret, row.backup_codes, code || '');
    if (!ok) return jsonError('That code is not valid.', 400);

    await env.DB.prepare('UPDATE user SET totp_secret = NULL, totp_enabled = 0, backup_codes = NULL WHERE id = ?')
      .bind(auth.id).run();
    return jsonOk({ success: true });
  } catch {
    return serverError();
  }
};
