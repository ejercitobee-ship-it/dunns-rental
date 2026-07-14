import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requireUser, requirePermission, jsonOk, jsonError, serverError } from '../../lib/session';

interface RoleRow {
  id: string;
  name: string;
  description: string | null;
  permissions: string;
  is_system: number;
}

export function serializeRole(r: RoleRow) {
  let permissions: string[] = [];
  try {
    const parsed = JSON.parse(r.permissions);
    if (Array.isArray(parsed)) permissions = parsed as string[];
  } catch {
    permissions = [];
  }
  return {
    id: r.id,
    name: r.name,
    description: r.description ?? '',
    permissions,
    isSystem: !!r.is_system,
  };
}

// GET /api/roles - any authenticated user (the app needs roles to resolve the
// current user's permissions for the UI).
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requireUser(env, request);
  if (auth instanceof Response) return auth;

  try {
    const { results } = await env.DB.prepare(
      'SELECT id, name, description, permissions, is_system FROM roles ORDER BY is_system DESC, name'
    ).all<RoleRow>();
    return jsonOk({ success: true, data: (results || []).map(serializeRole) });
  } catch {
    return serverError();
  }
};

// POST /api/roles - create a custom role.
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requirePermission(env, request, 'users_roles');
  if (auth instanceof Response) return auth;

  try {
    const body = (await request.json()) as {
      name?: string;
      description?: string;
      permissions?: string[];
    };
    const name = body.name?.trim();
    if (!name) return jsonError('Role name is required', 400);

    const id = crypto.randomUUID();
    const permissions = Array.isArray(body.permissions) ? body.permissions : [];
    await env.DB.prepare(
      'INSERT INTO roles (id, name, description, permissions, is_system) VALUES (?, ?, ?, ?, 0)'
    )
      .bind(id, name, body.description ?? '', JSON.stringify(permissions))
      .run();

    const row = await env.DB.prepare(
      'SELECT id, name, description, permissions, is_system FROM roles WHERE id = ?'
    )
      .bind(id)
      .first<RoleRow>();
    return jsonOk({ success: true, data: serializeRole(row as RoleRow) }, 201);
  } catch {
    return serverError();
  }
};
