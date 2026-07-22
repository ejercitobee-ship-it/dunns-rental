import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../lib/session';

/**
 * PUT /api/realtors/:id — edit a realtor's own details (name, email, phone).
 * A realtor is always a realtor here: this never changes their role, so it
 * cannot accidentally turn them into an internal user. When the email changes,
 * the login email moves with it (user + credential account), so they keep
 * signing in with the address on file.
 */
export const onRequestPut: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'tenants_edit');
  if (auth instanceof Response) return auth;

  try {
    const id = params.id as string;
    const existing = await env.DB.prepare(
      `SELECT u.id, u.email FROM user u
         JOIN user_roles ur ON ur.user_id = u.id
        WHERE u.id = ? AND ur.role = 'realtor'`
    )
      .bind(id)
      .first<{ id: string; email: string | null }>();
    if (!existing) return jsonError('Realtor not found', 404);

    const body = (await request.json()) as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
    const firstName = str(body.firstName);
    const lastName = str(body.lastName);
    const email = str(body.email);
    const phone = str(body.phone);
    if (!firstName) return jsonError('A first name is required', 400);
    const name = [firstName, lastName].filter(Boolean).join(' ');

    // Move the login email too when it changes. Sign-in lowercases input, so
    // store it lowercased. A clash with another account is a conflict.
    if (email && email.toLowerCase() !== (existing.email || '').toLowerCase()) {
      const lower = email.toLowerCase();
      const clash = await env.DB.prepare('SELECT id FROM user WHERE email = ? AND id != ?')
        .bind(lower, id)
        .first();
      if (clash) return jsonError('Someone already uses that email address', 409);
      await env.DB.prepare('UPDATE user SET email = ?, updated_at = unixepoch() WHERE id = ?').bind(lower, id).run();
      await env.DB.prepare('UPDATE account SET account_id = ? WHERE user_id = ? AND provider_id = ?')
        .bind(lower, id, 'credential')
        .run();
    }

    await env.DB.prepare('UPDATE user SET name = ?, phone = ?, updated_at = unixepoch() WHERE id = ?')
      .bind(name, phone || null, id)
      .run();

    return jsonOk({ success: true, data: { id, firstName, lastName, email, phone } });
  } catch {
    return serverError();
  }
};
