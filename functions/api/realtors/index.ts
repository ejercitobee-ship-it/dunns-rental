import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../lib/session';
import { createPortalLogin, sendInviteLink } from '../../lib/invite';

/**
 * GET /api/realtors — the realtor-role users, for the picker that links a
 * realtor to a tenant.
 *
 * Gated on tenants_edit, the same permission that links a realtor, on purpose:
 * being able to link one must come with being able to see the list to pick
 * from. The picker used to read the full users list, which needs users_view,
 * so a manager with tenants_edit but not users_view saw an empty picker with
 * no hint why. Only id, name, and email are returned, nothing else about the
 * account.
 */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requirePermission(env, request, 'tenants_edit');
  if (auth instanceof Response) return auth;

  try {
    const { results } = await env.DB.prepare(
      `SELECT u.id, u.name, u.email
         FROM user u
         JOIN user_roles ur ON ur.user_id = u.id
        WHERE ur.role = 'realtor' AND u.is_active = 1
        ORDER BY u.name`
    ).all<{ id: string; name: string; email: string }>();

    return jsonOk({ success: true, data: results || [] });
  } catch {
    return serverError();
  }
};

/**
 * POST /api/realtors — add a realtor. Creates a portal login with the realtor
 * role and emails a branded invite in the same step, mirroring how a handyman
 * is added. Gated on tenants_edit, the same permission that links a realtor to
 * a tenant.
 */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requirePermission(env, request, 'tenants_edit');
  if (auth instanceof Response) return auth;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
    const firstName = str(body.firstName);
    const lastName = str(body.lastName);
    const email = str(body.email);
    const phone = str(body.phone);
    if (!firstName) return jsonError('A first name is required', 400);
    if (!email) return jsonError('An email is required to send the invite', 400);

    const name = [firstName, lastName].filter(Boolean).join(' ');
    let userId: string;
    try {
      userId = await createPortalLogin(env, { email, name, role: 'realtor' });
    } catch (e) {
      if ((e as Error).message === 'email-taken') {
        return jsonError('Someone already uses that email address', 400);
      }
      throw e;
    }
    if (phone) {
      await env.DB.prepare('UPDATE user SET phone = ?, updated_at = unixepoch() WHERE id = ?').bind(phone, userId).run();
    }

    const res = await sendInviteLink(env, request, userId, firstName, email, false);
    return jsonOk(
      { success: true, data: { userId, emailSent: res.sent, inviteUrl: res.sent ? undefined : res.inviteUrl } },
      201
    );
  } catch {
    return serverError();
  }
};
