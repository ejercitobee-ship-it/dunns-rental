import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requireUser, jsonOk, jsonError, serverError } from '../../../lib/session';
import { handymanForUser } from '../../../lib/portal';
import { serializeHandyman } from '../../../lib/serializers';

/** The handyman's own roster row joined with their user photo, serialized. */
async function loadProfile(env: Env, handymanId: string) {
  const row = await env.DB.prepare(
    `SELECT h.*, u.image AS image
       FROM handymen h
       LEFT JOIN user u ON u.id = h.user_id
      WHERE h.id = ?`
  )
    .bind(handymanId)
    .first();
  return row ? serializeHandyman(row as Record<string, unknown>) : null;
}

/** GET /api/portal/handyman/me — the handyman's own profile. */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requireUser(env, request);
  if (auth instanceof Response) return auth;
  if (auth.role !== 'handyman') return jsonError('Not a handyman account', 403);

  try {
    const handyman = await handymanForUser(env, auth.id);
    if (!handyman) return jsonError('No active handyman record is linked to this login', 404);
    const profile = await loadProfile(env, handyman.id);
    if (!profile) return jsonError('Profile not found', 404);
    return jsonOk({ success: true, data: profile });
  } catch {
    return serverError();
  }
};

/**
 * PUT /api/portal/handyman/me — the handyman updates their own contact details.
 * Only name, phone, and address fields are editable here; their login email and
 * their trades are set by the office and stay read-only.
 */
export const onRequestPut: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requireUser(env, request);
  if (auth instanceof Response) return auth;
  if (auth.role !== 'handyman') return jsonError('Not a handyman account', 403);

  try {
    const handyman = await handymanForUser(env, auth.id);
    if (!handyman) return jsonError('No active handyman record is linked to this login', 404);

    const body = (await request.json()) as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
    const name = str(body.name);
    if (!name) return jsonError('A name is required', 400);

    await env.DB.prepare(
      `UPDATE handymen
          SET name = ?, phone = ?, address = ?, city = ?, state = ?, zip_code = ?, updated_at = unixepoch()
        WHERE id = ?`
    )
      .bind(
        name,
        str(body.phone) || null,
        str(body.address) || null,
        str(body.city) || null,
        str(body.state) || null,
        str(body.zipCode) || null,
        handyman.id
      )
      .run();

    const profile = await loadProfile(env, handyman.id);
    if (!profile) return serverError();
    return jsonOk({ success: true, data: profile });
  } catch {
    return serverError();
  }
};
