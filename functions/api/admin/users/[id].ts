import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../../lib/session';
import { deleteUserStatements } from '../../../lib/users';
import { serializeUser } from './index';

interface UserRow {
  id: string;
  name: string | null;
  email: string;
  is_active: number | null;
  phone: string | null;
  department: string | null;
  created_at: number | null;
  role: string | null;
}

async function loadUser(env: Env, id: string) {
  return env.DB.prepare(
    `SELECT u.id, u.name, u.email, u.is_active, u.phone, u.department, u.created_at, r.role AS role
       FROM user u
       LEFT JOIN user_roles r ON r.user_id = u.id
      WHERE u.id = ?`
  )
    .bind(id)
    .first<UserRow>();
}

// PUT /api/admin/users/:id - update a team member.
export const onRequestPut: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'users_edit');
  if (auth instanceof Response) return auth;

  try {
    const id = params.id as string;
    const existing = await loadUser(env, id);
    if (!existing) return jsonError('User not found', 404);

    const body = (await request.json()) as {
      firstName?: string;
      lastName?: string;
      phone?: string;
      department?: string;
      isActive?: boolean;
      roleId?: string;
    };

    const firstName = body.firstName?.trim() ?? '';
    const lastName = body.lastName?.trim() ?? '';
    const name = `${firstName} ${lastName}`.trim() || existing.name || '';
    const isActive = body.isActive === undefined ? existing.is_active ?? 1 : body.isActive ? 1 : 0;
    const now = Math.floor(Date.now() / 1000);

    await env.DB.prepare(
      'UPDATE user SET name = ?, phone = ?, department = ?, is_active = ?, updated_at = ? WHERE id = ?'
    )
      .bind(name, body.phone ?? null, body.department ?? null, isActive, now, id)
      .run();

    if (body.roleId) {
      // Validate the role exists, then set it as the user's single role.
      const role = await env.DB.prepare('SELECT id FROM roles WHERE id = ?').bind(body.roleId).first();
      if (!role) return jsonError('Invalid role', 400);
      await env.DB.prepare('DELETE FROM user_roles WHERE user_id = ?').bind(id).run();
      await env.DB.prepare(
        'INSERT INTO user_roles (id, user_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
      )
        .bind(crypto.randomUUID(), id, body.roleId, now, now)
        .run();
    }

    const updated = await loadUser(env, id);
    return jsonOk({ success: true, data: serializeUser(updated as UserRow) });
  } catch {
    return serverError();
  }
};

// DELETE /api/admin/users/:id - remove a team member.
export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'users_delete');
  if (auth instanceof Response) return auth;

  try {
    const id = params.id as string;
    if (auth.id === id) {
      return jsonError('You cannot delete your own account', 400);
    }

    const existing = await env.DB.prepare('SELECT id FROM user WHERE id = ?').bind(id).first();
    if (!existing) return jsonError('User not found', 404);

    // properties/expenses/incomes reference user(id) NOT NULL, so their owner
    // cannot be nulled out and the row cannot be deleted while they exist. That
    // only happens for staff accounts; tell the caller to deactivate instead of
    // failing with an opaque 500.
    const owned = await env.DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM properties WHERE user_id = ?1) AS properties,
         (SELECT COUNT(*) FROM expenses   WHERE user_id = ?1) AS expenses,
         (SELECT COUNT(*) FROM incomes    WHERE user_id = ?1) AS incomes`
    )
      .bind(id)
      .first<{ properties: number; expenses: number; incomes: number }>();
    if (owned && (owned.properties || owned.expenses || owned.incomes)) {
      return jsonError(
        'This user owns properties, expenses, or income records, so their history cannot be deleted. Deactivate the account instead.',
        409
      );
    }

    // Clear every foreign-key reference to this login (tenants/leases/etc.) and
    // remove its rows in one FK-safe transaction, so a tenant login deletes
    // cleanly instead of tripping "FOREIGN KEY constraint failed".
    await env.DB.batch(deleteUserStatements(env, id));

    return jsonOk({ success: true });
  } catch {
    return serverError();
  }
};
