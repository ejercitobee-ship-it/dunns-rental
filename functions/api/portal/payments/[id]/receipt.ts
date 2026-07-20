import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requireUser, jsonOk, jsonError, serverError } from '../../../../lib/session';
import { tenantIdForUser } from '../../../../lib/portal';
import { DriveNotConnected } from '../../../../lib/google';
import { generateReceipt } from '../../../../lib/receipts';

/**
 * POST /api/portal/payments/:id/receipt — a tenant generates the receipt for a
 * paid payment on THEIR OWN lease. Scoped: the payment must belong to a lease
 * the caller is on, and be paid. Reuses generateReceipt, so the receipt is
 * built and filed exactly like an owner-generated one.
 */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requireUser(env, request);
  if (auth instanceof Response) return auth;
  if (auth.role !== 'tenant') return jsonError('Not a tenant account', 403);

  try {
    const tenantId = await tenantIdForUser(env, auth.id);
    if (!tenantId) return jsonError('No tenant record is linked to this login', 404);

    const paymentId = params.id as string;
    // The payment must be on a lease this caller is actually on, and paid.
    const row = await env.DB.prepare(
      `SELECT rp.id, rp.status
         FROM rent_payments rp
         JOIN lease_tenants lt ON lt.lease_id = rp.lease_id
        WHERE rp.id = ? AND lt.tenant_id = ?`
    ).bind(paymentId, tenantId).first<{ id: string; status: string }>();
    if (!row) return jsonError('Payment not found', 404);
    if (row.status !== 'paid') return jsonError('Only a paid payment has a receipt', 400);

    const receiptDocumentId = await generateReceipt(env, paymentId, auth.id);
    if (!receiptDocumentId) {
      return jsonError('This payment cannot be receipted right now.', 400);
    }
    return jsonOk({ success: true, data: { receiptDocumentId } });
  } catch (err) {
    if (err instanceof DriveNotConnected) {
      return jsonError('Receipts are temporarily unavailable. Please contact your property manager.', 503);
    }
    return serverError();
  }
};
