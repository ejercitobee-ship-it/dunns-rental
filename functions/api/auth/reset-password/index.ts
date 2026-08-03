import type { PagesFunction } from '@cloudflare/workers-types';
import {
  type Env,
  getSessionUser,
  hashPassword,
  verifyPassword,
  jsonOk,
  jsonError,
  forbidden,
  unauthorized,
  serverError,
} from '../../../lib/session';
import { roleCan } from '../../../lib/permissions';

// POST /api/auth/reset-password
// Authorization is required in one of two ways:
//   1. A valid reset `token` (from the forgot-password flow), or
//   2. A valid session, in which case a user may reset their OWN password
//      (verifying their current password), and an admin with `users_edit`
//      may reset another user's password.
function hasPerm(user: { role: string; permissions: string[] | null }, perm: string): boolean {
  if (user.role === 'super_admin') return true;
  return user.permissions ? user.permissions.includes(perm) : roleCan(user.role, perm);
}
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  try {
    const body = (await request.json()) as {
      userId?: string;
      currentPassword?: string;
      newPassword?: string;
      token?: string;
    };
    const { userId, currentPassword, newPassword, token } = body;

    if (!newPassword || newPassword.length < 8) {
      return jsonError('Password must be at least 8 characters', 400);
    }

    const now = Math.floor(Date.now() / 1000);
    let targetUserId: string | null = null;
    let usedTokenId: string | null = null;

    if (token) {
      const row = await env.DB.prepare(
        'SELECT id, user_id FROM password_reset_tokens WHERE token = ? AND expires_at > ? AND used_at IS NULL'
      )
        .bind(token, now)
        .first<{ id: string; user_id: string }>();

      if (!row) {
        return jsonError('Invalid or expired reset token', 400);
      }
      targetUserId = row.user_id;
      usedTokenId = row.id;
    } else {
      const sessionUser = await getSessionUser(env, request);
      if (!sessionUser) {
        return unauthorized();
      }

      const requested = userId || sessionUser.id;
      if (requested !== sessionUser.id) {
        // Resetting someone else's password requires admin rights.
        if (!hasPerm(sessionUser, 'users_edit')) {
          return forbidden();
        }
        targetUserId = requested;
      } else {
        targetUserId = sessionUser.id;

        // Self-service reset: verify current password, unless the account is
        // flagged for a forced reset (temp password on first login).
        let forced = false;
        try {
          const flag = await env.DB.prepare(
            'SELECT value FROM user_metadata WHERE user_id = ? AND key = ?'
          )
            .bind(targetUserId, 'force_password_reset')
            .first<{ value: string }>();
          forced = flag?.value === 'true';
        } catch {
          // metadata table may not exist; treat as not forced.
        }

        if (!forced) {
          if (!currentPassword) {
            return jsonError('Current password is required', 400);
          }
          const account = await env.DB.prepare(
            'SELECT password FROM account WHERE user_id = ? AND provider_id = ?'
          )
            .bind(targetUserId, 'credential')
            .first<{ password: string }>();

          if (!account?.password) {
            return jsonError('Account not found', 404);
          }
          const { valid } = await verifyPassword(currentPassword, account.password);
          if (!valid) {
            return jsonError('Current password is incorrect', 401);
          }
        }
      }
    }

    const newHash = await hashPassword(newPassword);
    await env.DB.prepare(
      'UPDATE account SET password = ?, updated_at = ? WHERE user_id = ? AND provider_id = ?'
    )
      .bind(newHash, now, targetUserId, 'credential')
      .run();

    // Clear the forced-reset flag and invalidate the used token.
    await env.DB.prepare('DELETE FROM user_metadata WHERE user_id = ? AND key = ?')
      .bind(targetUserId, 'force_password_reset')
      .run();

    if (usedTokenId) {
      await env.DB.prepare('UPDATE password_reset_tokens SET used_at = ? WHERE id = ?')
        .bind(now, usedTokenId)
        .run();
    }

    return jsonOk({ success: true, message: 'Password reset successfully' });
  } catch {
    return serverError();
  }
};
