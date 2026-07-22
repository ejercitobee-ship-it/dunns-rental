import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../lib/session';
import { serializeHandyman } from '../../lib/serializers';
import { deleteUserStatements } from '../../lib/users';
import { MAINTENANCE_TRADES } from '../../lib/maintenance';

function cleanTrades(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const allowed = new Set<string>(MAINTENANCE_TRADES);
  return [...new Set(input.filter((t): t is string => typeof t === 'string' && allowed.has(t)))];
}

/** PUT /api/handymen/:id — edit roster fields (name, phone, email, trades, active). */
export const onRequestPut: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'properties_edit');
  if (auth instanceof Response) return auth;

  try {
    const id = params.id as string;
    const existing = await env.DB.prepare('SELECT * FROM handymen WHERE id = ?')
      .bind(id)
      .first<{ id: string; user_id: string | null; email: string | null }>();
    if (!existing) return jsonError('Handyman not found', 404);

    const body = (await request.json()) as Record<string, unknown>;
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return jsonError('A name is required', 400);
    const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
    const email = typeof body.email === 'string' ? body.email.trim() : '';
    const trades = cleanTrades(body.trades);
    const isActive = body.isActive === false ? 0 : 1;

    // When the email changes and this handyman has a login, move the login's
    // email too, so they keep signing in with the address on file. Sign-in
    // lowercases input, so store it lowercased. A clash with another user is a
    // conflict, not a silent no-op.
    if (existing.user_id && email && email.toLowerCase() !== (existing.email || '').toLowerCase()) {
      const lower = email.toLowerCase();
      const clash = await env.DB.prepare('SELECT id FROM user WHERE email = ? AND id != ?')
        .bind(lower, existing.user_id)
        .first();
      if (clash) return jsonError('Someone already uses that email address', 409);
      await env.DB.prepare('UPDATE user SET email = ?, updated_at = unixepoch() WHERE id = ?')
        .bind(lower, existing.user_id)
        .run();
      await env.DB.prepare('UPDATE account SET account_id = ? WHERE user_id = ? AND provider_id = ?')
        .bind(lower, existing.user_id, 'credential')
        .run();
    }

    await env.DB.prepare(
      `UPDATE handymen SET name = ?, phone = ?, email = ?, trades = ?, is_active = ?, updated_at = unixepoch()
       WHERE id = ?`
    )
      .bind(name, phone || null, email || null, JSON.stringify(trades), isActive, id)
      .run();

    const row = await env.DB.prepare('SELECT * FROM handymen WHERE id = ?').bind(id).first();
    return jsonOk({ success: true, data: serializeHandyman(row as Record<string, unknown>) });
  } catch {
    return serverError();
  }
};

/**
 * DELETE /api/handymen/:id — remove the handyman entirely: the roster row and
 * their portal login. Their jobs keep their history (assigned_handyman_id is set
 * NULL by the foreign key). To only pause someone, deactivate them (PUT
 * isActive: false) instead of deleting.
 */
export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'properties_edit');
  if (auth instanceof Response) return auth;

  try {
    const id = params.id as string;
    const h = await env.DB.prepare('SELECT id, user_id FROM handymen WHERE id = ?')
      .bind(id)
      .first<{ id: string; user_id: string | null }>();
    if (!h) return jsonError('Handyman not found', 404);

    const statements = [env.DB.prepare('DELETE FROM handymen WHERE id = ?').bind(id)];
    if (h.user_id) statements.push(...deleteUserStatements(env, h.user_id));
    await env.DB.batch(statements);

    return jsonOk({ success: true });
  } catch {
    return serverError();
  }
};
