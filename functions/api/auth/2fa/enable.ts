import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requireUser, jsonOk, jsonError, serverError } from '../../../lib/session';
import { verifyTotp, generateBackupCodes, hashBackupCode } from '../../../lib/totp';

/**
 * POST /api/auth/2fa/enable — confirm a code against the pending secret and turn
 * 2FA on. Returns one-time backup codes to save (shown once). Body: { code }.
 */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requireUser(env, request);
  if (auth instanceof Response) return auth;

  try {
    const { code } = (await request.json()) as { code?: string };
    const row = await env.DB.prepare('SELECT totp_secret FROM user WHERE id = ?')
      .bind(auth.id).first<{ totp_secret: string | null }>();
    if (!row?.totp_secret) return jsonError('Start setup first.', 400);
    if (!code || !(await verifyTotp(row.totp_secret, code))) {
      return jsonError('That code is not valid. Check your authenticator app and try again.', 400);
    }

    const backupCodes = generateBackupCodes(10);
    const hashes = await Promise.all(backupCodes.map(hashBackupCode));
    await env.DB.prepare('UPDATE user SET totp_enabled = 1, backup_codes = ? WHERE id = ?')
      .bind(JSON.stringify(hashes), auth.id).run();

    return jsonOk({ success: true, data: { backupCodes } });
  } catch {
    return serverError();
  }
};
