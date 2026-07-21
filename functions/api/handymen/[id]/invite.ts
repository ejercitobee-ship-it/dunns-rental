import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../../lib/session';
import { createPortalLogin, sendInviteLink } from '../../../lib/invite';

/**
 * POST /api/handymen/:id/invite — give this handyman a portal login, or resend
 * a fresh set-password link if they already have one. Mirrors the tenant invite
 * so a roster entry added without an email (or whose first link expired) can be
 * activated later without recreating the record.
 */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'properties_edit');
  if (auth instanceof Response) return auth;

  try {
    const id = params.id as string;
    const h = await env.DB.prepare('SELECT * FROM handymen WHERE id = ?')
      .bind(id)
      .first<{ id: string; user_id: string | null; name: string; email: string | null }>();
    if (!h) return jsonError('Handyman not found', 404);
    if (!h.email) return jsonError('This handyman has no email address to invite', 400);

    const firstName = h.name.split(' ')[0] || h.name;

    // Already has a login: resend a fresh link.
    if (h.user_id) {
      const { sent, inviteUrl } = await sendInviteLink(env, request, h.user_id, firstName, h.email, true);
      return jsonOk({ success: true, data: { emailSent: sent, inviteUrl: sent ? undefined : inviteUrl, resent: true } });
    }

    // No login yet: create one, link it, then send the first invite.
    let userId: string;
    try {
      userId = await createPortalLogin(env, { email: h.email, name: h.name, role: 'handyman' });
    } catch (e) {
      if ((e as Error).message === 'email-taken') {
        return jsonError('Someone already uses that email address', 400);
      }
      throw e;
    }
    await env.DB.prepare('UPDATE handymen SET user_id = ?, updated_at = unixepoch() WHERE id = ?')
      .bind(userId, id)
      .run();

    const { sent, inviteUrl } = await sendInviteLink(env, request, userId, firstName, h.email, false);
    return jsonOk({ success: true, data: { emailSent: sent, inviteUrl: sent ? undefined : inviteUrl } });
  } catch {
    return serverError();
  }
};
