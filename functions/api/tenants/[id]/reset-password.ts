import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../../lib/session';
import { resetUserPassword } from '../../../lib/users';

/**
 * POST /api/tenants/:id/reset-password — reset the tenant's portal login
 * password. Gated on tenants_edit like invite, so a tenant manager can do it
 * from the tenant's profile without users_edit. Reuses resetUserPassword, the
 * same routine the admin "reset user password" uses.
 */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'tenants_edit');
  if (auth instanceof Response) return auth;

  try {
    const tenantId = params.id as string;
    const tenant = await env.DB.prepare('SELECT user_id FROM tenants WHERE id = ?')
      .bind(tenantId)
      .first<{ user_id: string | null }>();
    if (!tenant) return jsonError('Tenant not found', 404);
    if (!tenant.user_id) {
      return jsonError('This tenant has no portal login yet. Invite them to the portal first.', 400);
    }

    const user = await env.DB.prepare('SELECT id, email FROM user WHERE id = ?')
      .bind(tenant.user_id)
      .first<{ id: string; email: string }>();
    if (!user) {
      return jsonError('This tenant has no portal login yet. Invite them to the portal first.', 400);
    }

    const tempPassword = await resetUserPassword(env, user.id, user.email);

    return jsonOk({
      success: true,
      tempPassword,
      message: 'Temporary password generated. Share it securely; they must change it at next sign-in.',
    });
  } catch {
    return serverError();
  }
};
