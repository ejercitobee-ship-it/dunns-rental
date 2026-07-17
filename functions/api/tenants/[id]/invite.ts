import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError, hashPassword, generateTempPassword } from '../../../lib/session';
import { sendEmail, portalInviteEmail } from '../../../lib/email';

const SEVEN_DAYS = 7 * 24 * 60 * 60;

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
    if (tenant.user_id) return jsonError('This tenant already has a login', 400);

    const existing = await env.DB.prepare('SELECT id FROM user WHERE email = ?')
      .bind(tenant.email)
      .first();
    if (existing) return jsonError('Someone already uses that email address', 400);

    const userId = crypto.randomUUID();
    const name = `${tenant.first_name} ${tenant.last_name}`.trim();
    const passwordHash = await hashPassword(generateTempPassword());
    const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
    const now = Math.floor(Date.now() / 1000);

    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO user (id, name, email, email_verified, image, is_active, created_at, updated_at)
         VALUES (?, ?, ?, 0, NULL, 1, ?, ?)`
      ).bind(userId, name, tenant.email, now, now),
      env.DB.prepare(
        'INSERT INTO account (id, account_id, provider_id, user_id, password, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).bind(crypto.randomUUID(), tenant.email, 'credential', userId, passwordHash, now, now),
      env.DB.prepare(
        'INSERT INTO user_roles (id, user_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
      ).bind(crypto.randomUUID(), userId, 'tenant', now, now),
      // This is the tenant's OWN new login id. Never the admin's (auth.id) —
      // tenants.user_id means "this person's own portal login" (migration 0010).
      env.DB.prepare('UPDATE tenants SET user_id = ?, updated_at = unixepoch() WHERE id = ?').bind(userId, tenantId),
      env.DB.prepare(
        'INSERT INTO password_reset_tokens (id, user_id, token, expires_at, created_at) VALUES (?, ?, ?, ?, ?)'
      ).bind(crypto.randomUUID(), userId, token, now + SEVEN_DAYS, now),
    ]);

    const inviteUrl = `${new URL(request.url).origin}/reset-password?token=${token}`;
    const mail = portalInviteEmail(inviteUrl, tenant.first_name);
    const sent = await sendEmail(env, { to: tenant.email, ...mail });

    // When mail is not configured the account still exists, so hand the link
    // back rather than stranding the tenant.
    return jsonOk({ success: true, data: { emailSent: sent, inviteUrl: sent ? undefined : inviteUrl } });
  } catch {
    return serverError();
  }
};
