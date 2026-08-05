import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, serverError } from '../../lib/session';

/**
 * GET /api/admin/permission-audit — paginated audit log of permission changes.
 * Query params: ?userId (filter), ?limit, ?offset
 */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requirePermission(env, request, 'users_permissions');
  if (auth instanceof Response) return auth;

  try {
    const url = new URL(request.url);
    const userId = url.searchParams.get('userId');
    const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 1), 200);
    const offset = Math.max(parseInt(url.searchParams.get('offset') || '0', 10) || 0, 0);

    let sql = `SELECT pal.*, u1.name AS target_name, u1.email AS target_email,
                      u2.name AS changed_by_name
               FROM permission_audit_log pal
               LEFT JOIN user u1 ON u1.id = pal.target_user_id
               LEFT JOIN user u2 ON u2.id = pal.changed_by_id`;
    const binds: unknown[] = [];

    if (userId) {
      sql += ' WHERE pal.target_user_id = ?';
      binds.push(userId);
    }

    sql += ' ORDER BY pal.created_at DESC LIMIT ? OFFSET ?';
    binds.push(limit, offset);

    const { results } = await env.DB.prepare(sql).bind(...binds).all();

    return jsonOk({
      success: true,
      data: (results || []).map(r => ({
        id: r.id,
        targetUserId: r.target_user_id,
        targetName: r.target_name || 'Unknown',
        targetEmail: r.target_email || '',
        changedById: r.changed_by_id,
        changedByName: r.changed_by_name || 'System',
        action: r.action,
        permission: r.permission,
        oldRole: r.old_role ?? undefined,
        newRole: r.new_role ?? undefined,
        createdAt: r.created_at,
      })),
    });
  } catch {
    return serverError();
  }
};
