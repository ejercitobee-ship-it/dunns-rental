import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../../lib/session';
import { realtorAccessEndsOn } from '../../../lib/portal';

/** GET /api/tenants/:id/realtors — who is linked, and when their access ends. */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'tenants_view');
  if (auth instanceof Response) return auth;

  try {
    const tenantId = params.id as string;
    const { results } = await env.DB.prepare(
      `SELECT tr.id, tr.realtor_user_id, u.name, u.email,
              date(tr.created_at, 'unixepoch') AS linked_on,
              (SELECT l.start_date FROM leases l
                 JOIN lease_tenants lt ON lt.lease_id = l.id
                WHERE lt.tenant_id = tr.tenant_id
                ORDER BY l.start_date DESC LIMIT 1) AS lease_start
         FROM tenant_realtors tr
         JOIN user u ON u.id = tr.realtor_user_id
        WHERE tr.tenant_id = ?`
    ).bind(tenantId).all<{ id: string; realtor_user_id: string; name: string; email: string; linked_on: string; lease_start: string | null }>();

    return jsonOk({
      success: true,
      data: (results || []).map(r => ({
        id: r.id,
        realtorUserId: r.realtor_user_id,
        name: r.name,
        email: r.email,
        linkedOn: r.linked_on,
        accessEndsOn: realtorAccessEndsOn(r.lease_start ?? undefined, r.linked_on),
      })),
    });
  } catch {
    return serverError();
  }
};

/** POST /api/tenants/:id/realtors — link a realtor. Body: { realtorUserId }. */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'tenants_edit');
  if (auth instanceof Response) return auth;

  try {
    const tenantId = params.id as string;
    const body = (await request.json()) as { realtorUserId?: string };
    if (!body.realtorUserId) return jsonError('A realtor is required', 400);

    const tenant = await env.DB.prepare('SELECT id FROM tenants WHERE id = ?').bind(tenantId).first();
    if (!tenant) return jsonError('Tenant not found', 404);

    const realtor = await env.DB.prepare(
      `SELECT u.id FROM user u
         JOIN user_roles ur ON ur.user_id = u.id
        WHERE u.id = ? AND ur.role = 'realtor'`
    ).bind(body.realtorUserId).first();
    if (!realtor) return jsonError('That user is not a realtor', 400);

    await env.DB.prepare(
      'INSERT OR IGNORE INTO tenant_realtors (id, tenant_id, realtor_user_id) VALUES (?, ?, ?)'
    ).bind(crypto.randomUUID(), tenantId, body.realtorUserId).run();

    return jsonOk({ success: true }, 201);
  } catch {
    return serverError();
  }
};

/** DELETE /api/tenants/:id/realtors?realtorUserId=... — unlink immediately. */
export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'tenants_edit');
  if (auth instanceof Response) return auth;

  try {
    const realtorUserId = new URL(request.url).searchParams.get('realtorUserId');
    if (!realtorUserId) return jsonError('A realtor is required', 400);
    await env.DB.prepare('DELETE FROM tenant_realtors WHERE tenant_id = ? AND realtor_user_id = ?')
      .bind(params.id as string, realtorUserId)
      .run();
    return jsonOk({ success: true });
  } catch {
    return serverError();
  }
};
