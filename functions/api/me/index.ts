import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requireUser, jsonOk, jsonError, serverError } from '../../lib/session';

/**
 * PUT /api/me — a signed-in user updates their OWN profile (name, phone). No
 * users_edit permission needed: this only ever touches the caller's own row, so
 * any team member can keep their own contact details current. Email and role
 * are not editable here (email is the login; role is assigned by an admin).
 */
export const onRequestPut: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requireUser(env, request);
  if (auth instanceof Response) return auth;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
    const firstName = str(body.firstName);
    const lastName = str(body.lastName);
    const phone = str(body.phone);
    if (!firstName) return jsonError('First name is required', 400);

    const name = [firstName, lastName].filter(Boolean).join(' ');
    await env.DB.prepare('UPDATE user SET name = ?, phone = ?, updated_at = unixepoch() WHERE id = ?')
      .bind(name, phone || null, auth.id)
      .run();

    return jsonOk({ success: true, data: { firstName, lastName, phone } });
  } catch {
    return serverError();
  }
};
