import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../../lib/session';
import { notifyLeaseStatusChange } from '../../../lib/lease-audit';

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'tenants_view');
  if (auth instanceof Response) return auth;

  try {
    const leaseId = params.id as string;
    const { results } = await env.DB.prepare(
      `SELECT n.id, n.lease_id, n.tenant_id, n.tenant_email, n.notification_type,
              n.subject, n.status, n.sent_by, n.created_at,
              t.first_name, t.last_name
       FROM lease_notifications n
       LEFT JOIN tenants t ON t.id = n.tenant_id
       WHERE n.lease_id = ? ORDER BY n.created_at DESC`
    ).bind(leaseId).all();

    const data = (results || []).map(r => ({
      id: r.id,
      leaseId: r.lease_id,
      tenantId: r.tenant_id,
      tenantEmail: r.tenant_email,
      tenantName: r.first_name ? `${r.first_name} ${r.last_name}` : null,
      notificationType: r.notification_type,
      subject: r.subject,
      status: r.status,
      sentBy: r.sent_by,
      createdAt: r.created_at,
    }));

    return jsonOk({ success: true, data });
  } catch {
    return serverError();
  }
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'tenants_edit');
  if (auth instanceof Response) return auth;

  try {
    const leaseId = params.id as string;
    const lease = await env.DB.prepare('SELECT status FROM leases WHERE id = ?').bind(leaseId).first();
    if (!lease) return jsonError('Lease not found', 404);

    const today = new Date().toISOString().slice(0, 10);
    await notifyLeaseStatusChange(env, leaseId, lease.status as string, today, undefined, auth.id);
    return jsonOk({ success: true, message: 'Notifications resent' });
  } catch {
    return serverError();
  }
};
