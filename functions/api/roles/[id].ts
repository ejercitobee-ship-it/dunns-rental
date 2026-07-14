import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../lib/session';
import { serializeRole } from './index';

interface RoleRow {
  id: string;
  name: string;
  description: string | null;
  permissions: string;
  is_system: number;
}

// PUT /api/roles/:id - update a role's name, description, or permissions.
export const onRequestPut: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'users_roles');
  if (auth instanceof Response) return auth;

  try {
    const id = params.id as string;
    const existing = await env.DB.prepare(
      'SELECT id, name, description, permissions, is_system FROM roles WHERE id = ?'
    )
      .bind(id)
      .first<RoleRow>();
    if (!existing) return jsonError('Role not found', 404);

    const body = (await request.json()) as {
      name?: string;
      description?: string;
      permissions?: string[];
    };

    // System role names are fixed; only their permissions can change.
    const name = existing.is_system ? existing.name : (body.name?.trim() || existing.name);
    const description = existing.is_system
      ? existing.description ?? ''
      : body.description ?? existing.description ?? '';
    const permissions = Array.isArray(body.permissions)
      ? body.permissions
      : JSON.parse(existing.permissions || '[]');

    await env.DB.prepare(
      'UPDATE roles SET name = ?, description = ?, permissions = ?, updated_at = unixepoch() WHERE id = ?'
    )
      .bind(name, description, JSON.stringify(permissions), id)
      .run();

    const row = await env.DB.prepare(
      'SELECT id, name, description, permissions, is_system FROM roles WHERE id = ?'
    )
      .bind(id)
      .first<RoleRow>();
    return jsonOk({ success: true, data: serializeRole(row as RoleRow) });
  } catch {
    return serverError();
  }
};

// DELETE /api/roles/:id - remove a custom role. System roles cannot be deleted.
export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'users_roles');
  if (auth instanceof Response) return auth;

  try {
    const id = params.id as string;
    const existing = await env.DB.prepare('SELECT is_system FROM roles WHERE id = ?')
      .bind(id)
      .first<{ is_system: number }>();
    if (!existing) return jsonError('Role not found', 404);
    if (existing.is_system) return jsonError('System roles cannot be deleted', 400);

    const assigned = await env.DB.prepare('SELECT COUNT(*) AS n FROM user_roles WHERE role = ?')
      .bind(id)
      .first<{ n: number }>();
    if ((assigned?.n ?? 0) > 0) {
      return jsonError('This role is assigned to users. Reassign them before deleting.', 409);
    }

    await env.DB.prepare('DELETE FROM roles WHERE id = ?').bind(id).run();
    return jsonOk({ success: true });
  } catch {
    return serverError();
  }
};
