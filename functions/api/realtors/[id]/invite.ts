import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../../lib/session';
import { sendInviteLink } from '../../../lib/invite';

/**
 * POST /api/realtors/:id/invite — resend the set-password link to a realtor.
 * Same branded invite as when they were added, so a realtor whose first invite
 * was missed (or expired) can be re-invited without recreating the account.
 */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'tenants_edit');
  if (auth instanceof Response) return auth;

  try {
    const id = params.id as string;
    const u = await env.DB.prepare(
      `SELECT u.id, u.name, u.email
         FROM user u
         JOIN user_roles ur ON ur.user_id = u.id
        WHERE u.id = ? AND ur.role = 'realtor'`
    )
      .bind(id)
      .first<{ id: string; name: string | null; email: string | null }>();
    if (!u) return jsonError('Realtor not found', 404);
    if (!u.email) return jsonError('This realtor has no email address to invite', 400);

    const firstName = (u.name || '').split(' ')[0] || u.name || 'there';
    const { sent, inviteUrl } = await sendInviteLink(env, u.id, firstName, u.email, true);
    return jsonOk({ success: true, data: { emailSent: sent, inviteUrl: sent ? undefined : inviteUrl } });
  } catch {
    return serverError();
  }
};
