import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../../../lib/session';
import { ALL_PERMISSIONS } from '../../../../lib/permissions';

/**
 * GET /api/admin/users/:id/permissions — list the per-user permission
 * overrides for a team member (not the full effective set, just the extras).
 */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'users_permissions');
  if (auth instanceof Response) return auth;

  try {
    const userId = params.id as string;
    const { results } = await env.DB.prepare(
      `SELECT permission, granted_by, granted_at FROM user_permission_overrides
       WHERE user_id = ? ORDER BY granted_at DESC`
    ).bind(userId).all();

    return jsonOk({
      success: true,
      data: (results || []).map(r => ({
        permission: r.permission,
        grantedBy: r.granted_by,
        grantedAt: r.granted_at,
      })),
    });
  } catch {
    return serverError();
  }
};

/**
 * POST /api/admin/users/:id/permissions — grant one or more per-user
 * permission overrides. Body: { permissions: string[] }
 */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'users_permissions');
  if (auth instanceof Response) return auth;

  try {
    const userId = params.id as string;
    const body = (await request.json()) as { permissions?: string[] };
    if (!Array.isArray(body.permissions) || body.permissions.length === 0) {
      return jsonError('Provide at least one permission to grant.', 400);
    }

    // Validate that every permission name is known
    const allPerms: readonly string[] = ALL_PERMISSIONS;
    const invalid = body.permissions.filter(p => !allPerms.includes(p));
    if (invalid.length > 0) {
      return jsonError(`Unknown permission(s): ${invalid.join(', ')}`, 400);
    }

    // Prevent granting permissions to yourself (except super admin)
    if (userId === auth.id && auth.role !== 'super_admin') {
      return jsonError('You cannot grant permissions to yourself.', 403);
    }

    const stmts: ReturnType<typeof env.DB.prepare>[] = [];
    const now = Math.floor(Date.now() / 1000);

    for (const perm of body.permissions) {
      // Upsert: if the override already exists, it is a no-op.
      stmts.push(
        env.DB.prepare(
          `INSERT INTO user_permission_overrides (user_id, permission, granted_by, granted_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(user_id, permission) DO NOTHING`
        ).bind(userId, perm, auth.id, now)
      );
      // Audit log
      stmts.push(
        env.DB.prepare(
          `INSERT INTO permission_audit_log
           (id, target_user_id, changed_by_id, action, permission, created_at)
           VALUES (?, ?, ?, 'grant', ?, ?)`
        ).bind(crypto.randomUUID(), userId, auth.id, perm, now)
      );
    }

    await env.DB.batch(stmts);

    return jsonOk({ success: true, granted: body.permissions.length });
  } catch {
    return serverError();
  }
};

/**
 * DELETE /api/admin/users/:id/permissions — revoke one or more per-user
 * permission overrides. Body: { permissions: string[] }
 */
export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'users_permissions');
  if (auth instanceof Response) return auth;

  try {
    const userId = params.id as string;
    const body = (await request.json()) as { permissions?: string[] };
    if (!Array.isArray(body.permissions) || body.permissions.length === 0) {
      return jsonError('Provide at least one permission to revoke.', 400);
    }

    const stmts: ReturnType<typeof env.DB.prepare>[] = [];
    const now = Math.floor(Date.now() / 1000);

    for (const perm of body.permissions) {
      stmts.push(
        env.DB.prepare(
          'DELETE FROM user_permission_overrides WHERE user_id = ? AND permission = ?'
        ).bind(userId, perm)
      );
      // Audit log
      stmts.push(
        env.DB.prepare(
          `INSERT INTO permission_audit_log
           (id, target_user_id, changed_by_id, action, permission, created_at)
           VALUES (?, ?, ?, 'revoke', ?, ?)`
        ).bind(crypto.randomUUID(), userId, auth.id, perm, now)
      );
    }

    await env.DB.batch(stmts);

    return jsonOk({ success: true, revoked: body.permissions.length });
  } catch {
    return serverError();
  }
};
