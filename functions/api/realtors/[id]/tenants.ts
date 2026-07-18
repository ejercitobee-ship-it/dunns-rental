import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../../lib/session';
import { validateTenantContact, createTenantForRealtor } from '../../../lib/realtorTenants';
import { serializeTenant } from '../../../lib/serializers';

// POST /api/realtors/:id/tenants — staff create a tenant and link it to a realtor.
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'tenants_create');
  if (auth instanceof Response) return auth;

  try {
    const realtorId = params.id as string;
    // The target must be an active realtor-role user, or the link is meaningless.
    const realtor = await env.DB.prepare(
      `SELECT u.id FROM user u
         JOIN user_roles r ON r.user_id = u.id
        WHERE u.id = ? AND r.role = 'realtor' AND u.is_active = 1`
    ).bind(realtorId).first();
    if (!realtor) return jsonError('That realtor was not found', 404);

    const valid = validateTenantContact((await request.json()) as Record<string, unknown>);
    if (!valid.ok) return jsonError(valid.error, 400);

    const row = await createTenantForRealtor(env, realtorId, valid.value);
    return jsonOk({ success: true, data: serializeTenant(row) }, 201);
  } catch {
    return serverError();
  }
};
