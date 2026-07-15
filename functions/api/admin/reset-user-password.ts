import type { PagesFunction } from '@cloudflare/workers-types';
import {
  type Env,
  requirePermission,
  hashPassword,
  generateTempPassword,
  jsonOk,
  jsonError,
  serverError,
} from '../../lib/session';

// POST /api/admin/reset-user-password { userId }
// An admin generates a new temporary password for a team member. The password
// is returned once so it can be shared out of band, and the user is forced to
// change it on their next sign-in.
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requirePermission(env, request, 'users_edit');
  if (auth instanceof Response) return auth;

  try {
    const body = (await request.json()) as { userId?: string };
    const userId = body.userId;
    if (!userId) return jsonError('userId is required', 400);

    const user = await env.DB.prepare('SELECT id, email FROM user WHERE id = ?')
      .bind(userId)
      .first<{ id: string; email: string }>();
    if (!user) return jsonError('User not found', 404);

    const tempPassword = generateTempPassword();
    const hash = await hashPassword(tempPassword);
    const now = Math.floor(Date.now() / 1000);

    const updated = await env.DB.prepare(
      'UPDATE account SET password = ?, updated_at = ? WHERE user_id = ? AND provider_id = ?'
    )
      .bind(hash, now, userId, 'credential')
      .run();

    // If the user somehow has no credential row, create one so they can sign in.
    if (!updated.meta.changes) {
      await env.DB.prepare(
        'INSERT INTO account (id, account_id, provider_id, user_id, password, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
        .bind(crypto.randomUUID(), user.email, 'credential', userId, hash, now, now)
        .run();
    }

    // Force a change on next sign-in.
    await env.DB.prepare(
      `INSERT INTO user_metadata (id, user_id, key, value, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
      .bind(crypto.randomUUID(), userId, 'force_password_reset', 'true', now, now)
      .run();

    // Any existing sessions for that user are no longer trustworthy.
    await env.DB.prepare('DELETE FROM session WHERE user_id = ?').bind(userId).run();

    return jsonOk({
      success: true,
      tempPassword,
      message: 'Temporary password generated. Share it securely; they must change it at next sign-in.',
    });
  } catch {
    return serverError();
  }
};
