import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requireUser, jsonOk, jsonError, serverError } from '../../lib/session';
import { tenantIdForUser } from '../../lib/portal';
import { serializePortalLease } from '../../lib/serializers';

/**
 * GET /api/portal/payments — the payment history of the caller's own lease.
 *
 * Belle's decision: on a shared rent a tenant sees the lease totals and never
 * who paid what. So paid_by_tenant_id is not selected at all. It cannot leak
 * through a serializer if it never leaves the database.
 */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requireUser(env, request);
  if (auth instanceof Response) return auth;
  if (auth.role !== 'tenant') return jsonError('Not a tenant account', 403);

  try {
    const tenantId = await tenantIdForUser(env, auth.id);
    if (!tenantId) return jsonError('No tenant record is linked to this login', 404);

    const lease = await env.DB.prepare(
      `SELECT l.* FROM leases l
         JOIN lease_tenants lt ON lt.lease_id = l.id
        WHERE lt.tenant_id = ? AND l.status != 'ended'
        ORDER BY l.start_date DESC LIMIT 1`
    ).bind(tenantId).first();

    if (!lease) return jsonOk({ success: true, data: { lease: null, payments: [] } });

    // Only the columns a tenant may see. No payer, no uploaded_by, no notes.
    const { results } = await env.DB.prepare(
      `SELECT amount, due_date, paid_date, status, month, year
         FROM rent_payments
        WHERE lease_id = ?
        ORDER BY year DESC, month DESC`
    ).bind(lease.id).all();

    return jsonOk({
      success: true,
      data: {
        lease: serializePortalLease(lease as Record<string, unknown>),
        payments: (results || []).map(r => ({
          amount: r.amount,
          dueDate: r.due_date ?? undefined,
          paidDate: r.paid_date ?? undefined,
          status: r.status,
          month: r.month,
          year: r.year,
        })),
      },
    });
  } catch {
    return serverError();
  }
};
