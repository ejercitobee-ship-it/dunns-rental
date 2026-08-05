import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../../lib/session';
import { generateMoveInFeeReceipt } from '../../../lib/receipts';
import { logLeaseChange } from '../../../lib/lease-audit';

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

    context.waitUntil(
      logLeaseChange(env, {
        leaseId,
        action: 'Move-in Fee Recorded',
        changedBy: auth.id,
        changedByName: auth.name,
        newData: { amount, paidDate, method },
        notes: 'Move-in fee marked as paid',
      }).catch(() => {})
    );

    return jsonOk({
      success: true,
      data: { moveInFeePaid: true, moveInFeePaidDate: paidDate, moveInFeeMethod: method ?? undefined, securityDeposit: amount, receiptDocumentId },
    });
  } catch {
    return serverError();
  }
};

/**
 * PUT /api/leases/:id/move-in-fee — edit the move-in fee paid date and/or
 * amount. Restricted to super_admin only. Every change is audit-logged with
 * the previous value, the new value, who made the change, and an optional
 * reason.
 */
export const onRequestPut: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'leases_move_in');
  if (auth instanceof Response) return auth;

  try {
    const leaseId = params.id as string;
    const lease = await env.DB.prepare(
      `SELECT id, security_deposit, move_in_fee_paid, move_in_fee_paid_date, move_in_fee_method, property_id, unit_id
       FROM leases WHERE id = ?`
    ).bind(leaseId).first<{
      id: string; security_deposit: number | null;
      move_in_fee_paid: number; move_in_fee_paid_date: string | null; move_in_fee_method: string | null;
      property_id: string | null; unit_id: string | null;
    }>();
    if (!lease) return jsonError('Lease not found', 404);

    const body = (await request.json()) as {
      paidDate?: string;
      amount?: number;
      method?: string;
      reason?: string;
    };

    const updates: string[] = [];
    const binds: unknown[] = [];
    const previousData: Record<string, unknown> = {};
    const newData: Record<string, unknown> = {};

    if (body.paidDate !== undefined) {
      const date = String(body.paidDate).slice(0, 10);
      if (!date) return jsonError('Enter a valid date.', 400);
      previousData.paidDate = lease.move_in_fee_paid_date;
      newData.paidDate = date;
      updates.push('move_in_fee_paid_date = ?');
      binds.push(date);
    }

    if (body.amount !== undefined) {
      const amount = Number(body.amount);
      if (!Number.isFinite(amount) || amount <= 0) return jsonError('Enter a valid amount.', 400);
      previousData.amount = lease.security_deposit;
      newData.amount = amount;
      updates.push('security_deposit = ?');
      binds.push(amount);
    }

    if (body.method !== undefined) {
      previousData.method = lease.move_in_fee_method;
      newData.method = body.method;
      updates.push('move_in_fee_method = ?');
      binds.push(body.method || null);
    }

    if (updates.length === 0) return jsonError('No changes provided.', 400);

    updates.push('updated_at = unixepoch()');
    binds.push(leaseId);

    await env.DB.prepare(
      `UPDATE leases SET ${updates.join(', ')} WHERE id = ?`
    ).bind(...binds).run();

    // Sync the idempotent income row. Uses INSERT ... ON CONFLICT so the
    // row is created if it was never recorded (legacy data) and updated
    // otherwise. This is the same pattern the POST handler uses.
    if (newData.amount !== undefined || newData.paidDate !== undefined) {
      const incomeAmount = (newData.amount as number) ?? lease.security_deposit ?? 0;
      const incomeDate = (newData.paidDate as string) ?? lease.move_in_fee_paid_date ?? '';
      if (incomeDate && incomeAmount > 0) {
        await env.DB.prepare(
          `INSERT INTO incomes (id, property_id, unit_id, source, amount, date, description, user_id)
           VALUES (?, ?, ?, 'move_in_fee', ?, ?, 'Move-in fee', ?)
           ON CONFLICT(id) DO UPDATE SET amount = excluded.amount, date = excluded.date`
        ).bind(`movein-${leaseId}`, lease.property_id, lease.unit_id, incomeAmount, incomeDate, auth.id).run();
      }
    }

    context.waitUntil(
      logLeaseChange(env, {
        leaseId,
        action: 'Move-in Fee Edited',
        changedBy: auth.id,
        changedByName: auth.name,
        previousData,
        newData,
        notes: body.reason || 'Super admin edited move-in fee details',
      }).catch(() => {})
    );

    return jsonOk({ success: true });
  } catch {
    return serverError();
  }
};
