import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError, hashPassword, generateTempPassword } from '../../../lib/session';
import { sendInviteLink } from '../../../lib/invite';

/**
 * POST /api/tenants/:id/invite — give a tenant a portal login.
 *
 * Creates the user with the tenant role and an unguessable random password the
 * tenant never learns, links it to the tenant record, then emails a set
 * password link. The token reuses password_reset_tokens and the existing
 * /reset-password page, so there is one password setting flow, not two.
 *
 * Passwords in this app live on the `account` table (provider_id = 'credential'),
 * not on `user`, and role assignment is `user_roles.role`, not `role_id` — see
 * functions/api/auth/sign-up/email/index.ts for the same pattern.
 */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'tenants_edit');
  if (auth instanceof Response) return auth;

  try {
    const tenantId = params.id as string;
    const tenant = await env.DB.prepare('SELECT * FROM tenants WHERE id = ?')
      .bind(tenantId)
      .first<{ id: string; email: string | null; first_name: string; last_name: string; user_id: string | null }>();
    if (!tenant) return jsonError('Tenant not found', 404);
    if (!tenant.email) return jsonError('This tenant has no email address to invite', 400);

    // Already has a login: RESEND a fresh set-password link. This is the path
    // when the first invite expired (7 days) — the old flow just 400'd here,
    // leaving no way to re-invite without hand-delivering a temp password.
    if (tenant.user_id) {
      const { sent, inviteUrl } = await sendInviteLink(env, tenant.user_id, tenant.first_name, tenant.email, true);
      return jsonOk({ success: true, data: { emailSent: sent, inviteUrl: sent ? undefined : inviteUrl, resent: true } });
    }

    // Store the login email normalised, because sign-in lowercases what the
    // tenant types before looking the user up. Without this, a tenant whose
    // record has any capital letter (Bob.Smith@Gmail.com) could set a password
    // via the link and then never log in, and nothing would surface the break.
    const email = tenant.email.trim().toLowerCase();

    const existing = await env.DB.prepare('SELECT id FROM user WHERE email = ?')
      .bind(email)
      .first();
    if (existing) return jsonError('Someone already uses that email address', 400);

    const userId = crypto.randomUUID();
    const name = `${tenant.first_name} ${tenant.last_name}`.trim();
    const passwordHash = await hashPassword(generateTempPassword());
    const now = Math.floor(Date.now() / 1000);

    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO user (id, name, email, email_verified, image, is_active, created_at, updated_at)
         VALUES (?, ?, ?, 0, NULL, 1, ?, ?)`
      ).bind(userId, name, email, now, now),
      env.DB.prepare(
        'INSERT INTO account (id, account_id, provider_id, user_id, password, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).bind(crypto.randomUUID(), email, 'credential', userId, passwordHash, now, now),
      env.DB.prepare(
        'INSERT INTO user_roles (id, user_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
      ).bind(crypto.randomUUID(), userId, 'tenant', now, now),
      // This is the tenant's OWN new login id. Never the admin's (auth.id) —
      // tenants.user_id means "this person's own portal login" (migration 0010).
      env.DB.prepare('UPDATE tenants SET user_id = ?, updated_at = unixepoch() WHERE id = ?').bind(userId, tenantId),
    ]);

    // When mail is not configured the account still exists, so hand the link
    // back rather than stranding the tenant.
    const { sent, inviteUrl } = await sendInviteLink(env, userId, tenant.first_name, tenant.email, false);
    return jsonOk({ success: true, data: { emailSent: sent, inviteUrl: sent ? undefined : inviteUrl } });
  } catch {
    return serverError();
  }
};
