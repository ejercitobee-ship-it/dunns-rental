import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requireUser, jsonOk, jsonError, serverError } from '../../lib/session';
import { tenantIdForUser, leasePauses } from '../../lib/portal';
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
        WHERE lt.tenant_id = ? AND l.status != 'ended' AND (l.needs_review IS NULL OR l.needs_review = 0)
        ORDER BY l.start_date DESC LIMIT 1`
    ).bind(tenantId).first();

    if (!lease) return jsonOk({ success: true, data: { lease: null, payments: [] } });

    // The lease's pauses, so the tenant's rows agree with the owner's Rent
    // Management about which months were owed (a paused month is not owed).
    (lease as Record<string, unknown>).pauses = await leasePauses(env, lease.id as string);

    // Only the columns a tenant may see. payment_method is the method only
    // (cash, check, zelle): still no payer, no uploaded_by, no notes. The id and
    // receipt_document_id ARE exposed: they are the tenant's OWN rent on their
    // OWN lease, and are what let them download or generate their receipt. The
    // sensitive field (paid_by_tenant_id) is still never selected.
    const { results } = await env.DB.prepare(
      `SELECT id, amount, due_date, paid_date, status, month, year, payment_method, receipt_document_id
         FROM rent_payments
        WHERE lease_id = ?
        ORDER BY year DESC, month DESC`
    ).bind(lease.id).all();

    // The move-in fee, when paid, shows in the tenant's payment history too,
    // with its receipt. Derived from the lease, not a rent_payment.
    const l = lease as Record<string, unknown>;
    const moveInFee = l.move_in_fee_paid && Number(l.security_deposit || 0) > 0
      ? {
          amount: Number(l.security_deposit || 0),
          paidDate: (l.move_in_fee_paid_date as string) ?? undefined,
          method: (l.move_in_fee_method as string) ?? undefined,
          receiptDocumentId: (l.move_in_fee_receipt_document_id as string) ?? undefined,
        }
      : null;

    return jsonOk({
      success: true,
      data: {
        lease: serializePortalLease(lease as Record<string, unknown>),
        moveInFee,
        payments: (results || []).map(r => ({
          id: r.id,
          amount: r.amount,
          dueDate: r.due_date ?? undefined,
          paidDate: r.paid_date ?? undefined,
          status: r.status,
          month: r.month,
          year: r.year,
          paymentMethod: r.payment_method ?? undefined,
          receiptDocumentId: r.receipt_document_id ?? undefined,
        })),
      },
    });
  } catch {
    return serverError();
  }
};
