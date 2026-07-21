import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requireUser, jsonOk, jsonError, serverError } from '../../lib/session';
import { tenantIdForUser } from '../../lib/portal';

/**
 * POST /api/portal/emergency-contact — a tenant ADDS their own emergency
 * contact, but only when one is not already on file. Editing an existing one
 * stays with the office (the portal is otherwise read-only for personal
 * details); this just lets a tenant fill in a blank.
 */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requireUser(env, request);
  if (auth instanceof Response) return auth;

  try {
    const tenantId = await tenantIdForUser(env, auth.id);
    if (!tenantId) return jsonError('Only a tenant can set this', 403);

    const current = await env.DB.prepare(
      `SELECT emergency_contact_name AS name, emergency_contact_phone AS phone,
              emergency_contact_relationship AS rel
         FROM tenants WHERE id = ?`
    ).bind(tenantId).first<{ name: string | null; phone: string | null; rel: string | null }>();
    if (current && (current.name || current.phone || current.rel)) {
      return jsonError('You already have an emergency contact on file. Please contact us to change it.', 409);
    }

    const body = (await request.json()) as { name?: string; phone?: string; relationship?: string };
    const name = (body.name || '').trim();
    const phone = (body.phone || '').trim();
    const relationship = (body.relationship || '').trim();
    if (!name) return jsonError('Please enter a name.', 400);

    await env.DB.prepare(
      `UPDATE tenants SET emergency_contact_name = ?, emergency_contact_phone = ?,
              emergency_contact_relationship = ?, updated_at = unixepoch()
         WHERE id = ?`
    ).bind(name, phone || null, relationship || null, tenantId).run();

    return jsonOk({ success: true, data: { name, phone, relationship } });
  } catch {
    return serverError();
  }
};
