import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../../lib/session';
import { generateMoveInFeeReceipt } from '../../../lib/receipts';

/**
 * POST /api/leases/:id/move-in-fee — record the move-in fee as paid. Marks the
 * lease's move-in fee paid with a date + method, records the money as income
 * (idempotent `movein-<leaseId>` row so re-recording never double counts), and
 * generates the tenant's move-in fee receipt (best-effort). The app never moves
 * money; this only records it.
 */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'rents_record');
  if (auth instanceof Response) return auth;

  try {
    const leaseId = params.id as string;
    const lease = await env.DB.prepare(
      'SELECT id, property_id, unit_id, security_deposit FROM leases WHERE id = ?'
    ).bind(leaseId).first<{ id: string; property_id: string | null; unit_id: string | null; security_deposit: number | null }>();
    if (!lease) return jsonError('Lease not found', 404);

    const body = (await request.json()) as { amount?: number; paidDate?: string; method?: string };
    const amount = body.amount != null ? Number(body.amount) : (lease.security_deposit || 0);
    if (!Number.isFinite(amount) || amount <= 0) return jsonError('Enter a valid move-in fee amount.', 400);
    const paidDate = (body.paidDate || '').slice(0, 10);
    if (!paidDate) return jsonError('Enter the date the fee was paid.', 400);
    const method = body.method ? String(body.method) : null;

    await env.DB.batch([
      env.DB.prepare(
        `UPDATE leases
            SET security_deposit = ?, move_in_fee_paid = 1, move_in_fee_paid_date = ?, move_in_fee_method = ?,
                updated_at = unixepoch()
          WHERE id = ?`
      ).bind(amount, paidDate, method, leaseId),
      // Record the fee as income, idempotent by a lease-derived id so a
      // correction updates the same row instead of duplicating it.
      env.DB.prepare(
        `INSERT INTO incomes (id, property_id, unit_id, source, amount, date, description, user_id)
         VALUES (?, ?, ?, 'move_in_fee', ?, ?, 'Move-in fee', ?)
         ON CONFLICT(id) DO UPDATE SET
           amount = excluded.amount, date = excluded.date, property_id = excluded.property_id,
           unit_id = excluded.unit_id, source = excluded.source`
      ).bind(`movein-${leaseId}`, lease.property_id, lease.unit_id, amount, paidDate, auth.id),
    ]);

    // Best-effort receipt: a Drive/PDF hiccup must not fail the recording.
    let receiptDocumentId: string | null = null;
    try {
      receiptDocumentId = await generateMoveInFeeReceipt(env, leaseId, auth.id);
    } catch { /* the fee is recorded regardless */ }

    return jsonOk({
      success: true,
      data: { moveInFeePaid: true, moveInFeePaidDate: paidDate, moveInFeeMethod: method ?? undefined, securityDeposit: amount, receiptDocumentId },
    });
  } catch {
    return serverError();
  }
};
