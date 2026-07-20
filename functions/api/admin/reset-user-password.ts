import type { PagesFunction } from '@cloudflare/workers-types';
import {
  type Env,
  requirePermission,
  jsonOk,
  jsonError,
  serverError,
} from '../../lib/session';
import { resetUserPassword } from '../../lib/users';

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

    const tempPassword = await resetUserPassword(env, user.id, user.email);

    return jsonOk({
      success: true,
      tempPassword,
      message: 'Temporary password generated. Share it securely; they must change it at next sign-in.',
    });
  } catch {
    return serverError();
  }
};
