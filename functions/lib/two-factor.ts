import { type Env } from './session';
import { verifyTotp, hashBackupCode } from './totp';

/**
 * Verify a 2FA `code` for a user: a valid TOTP passes; otherwise a matching
 * one-time backup code passes and is CONSUMED (removed from the stored list).
 * Returns whether the code was accepted.
 */
export async function verifyUserTwoFactor(
  env: Env,
  userId: string,
  secret: string | null,
  backupCodesJson: string | null,
  code: string
): Promise<boolean> {
  const clean = (code || '').trim();
  if (!clean) return false;

  if (secret && (await verifyTotp(secret, clean))) return true;

  // Backup code path: hashes stored as a JSON array; consume on match.
  if (!backupCodesJson) return false;
  let hashes: string[];
  try {
    hashes = JSON.parse(backupCodesJson);
    if (!Array.isArray(hashes)) return false;
  } catch {
    return false;
  }
  const h = await hashBackupCode(clean);
  const idx = hashes.indexOf(h);
  if (idx === -1) return false;
  hashes.splice(idx, 1);
  await env.DB.prepare('UPDATE user SET backup_codes = ? WHERE id = ?')
    .bind(JSON.stringify(hashes), userId).run();
  return true;
}
