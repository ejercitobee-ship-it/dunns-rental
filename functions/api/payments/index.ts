import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../lib/session';
import { serializePayment, serializeAllocation } from '../../lib/serializers';
import { syncRentSheet } from '../../lib/sheets';
import { generateReceipt } from '../../lib/receipts';
import { logActivityStmt } from '../../lib/activity';

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requirePermission(env, request, 'rents_view');
  if (auth instanceof Response) return auth;

  try {
    const { results } = await env.DB.prepare(
      'SELECT * FROM rent_payments ORDER BY created_at DESC'
    ).all();
    return jsonOk({ success: true, data: (results || []).map(serializePayment) });
  } catch {
    return serverError();
  }
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requirePermission(env, request, 'rents_record');
  if (auth instanceof Response) return auth;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    if (!body.leaseId) return jsonError('A lease is required', 400);
    // Amount must be a real, positive number. The app's own form enforces this,
    // but the endpoint has to as well: a direct call could otherwise store a
    // negative or non-numeric amount, which then corrupts every settlement and
    // income total that sums it.
    const amount = Number(body.amount);
    if (body.amount === undefined || body.amount === null || !Number.isFinite(amount) || amount <= 0) {
      return jsonError('Amount must be a positive number', 400);
    }
    // month and year are nullable columns, so without this check a payment
    // with neither could be inserted. serializePayment then returns
    // month: null typed as number, paymentsForMonth never matches it on any
    // month, and the payment sits in the database invisible on every screen.
    if (body.month === undefined || body.month === null) {
      return jsonError('Month is required', 400);
    }
    if (body.year === undefined || body.year === null) {
      return jsonError('Year is required', 400);
    }

    const paymentType = body.type === 'credit' ? 'credit' : 'payment';
    const creditReason = paymentType === 'credit' ? (body.creditReason ?? null) : null;

    const id = crypto.randomUUID();
    const stmts = [
      env.DB.prepare(
        `INSERT INTO rent_payments (id, lease_id, paid_by_tenant_id, amount, due_date, paid_date,
          received_date, status, month, year, payment_method, uploaded_by, uploaded_at, notes, type, credit_reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(
          id,
          body.leaseId,
          body.paidByTenantId ?? null,
          amount,
          body.dueDate ?? null,
          body.paidDate ?? null,
          body.receivedDate ?? null,
          body.status ?? 'pending',
          body.month,
          body.year,
          body.paymentMethod ?? null,
          body.uploadedBy ?? auth.id,
          body.uploadedAt ?? null,
          body.notes ?? null,
          paymentType,
          creditReason
        ),
      logActivityStmt(env.DB, auth, {
        module: 'finances',
        action: paymentType === 'credit' ? 'Applied a rent credit' : 'Recorded a rent payment',
        targetType: 'payments',
        targetId: id,
        description: `$${amount} ${paymentType === 'credit' ? 'credit' : ''} for ${body.month}/${body.year}${creditReason ? ` (${creditReason})` : ''}`,
        newValues: { amount, month: body.month, year: body.year, status: body.status ?? 'pending', paymentMethod: body.paymentMethod, type: paymentType, creditReason },
      }),
    ];

    // When a credit is applied from the tenant's credit balance, also debit
    // the tenant_credits ledger so the running balance stays accurate.
    if (paymentType === 'credit' && body.debitCreditBalance && body.paidByTenantId) {
      stmts.push(
        env.DB.prepare(
          `INSERT INTO tenant_credits (id, tenant_id, amount, reason, notes, applied_to_payment_id, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          crypto.randomUUID(),
          body.paidByTenantId,
          -amount,
          creditReason,
          `Applied to ${body.month}/${body.year} rent`,
          id,
          auth.id
        )
      );
    }

    // Insert payment allocations when provided.
    // Each allocation links this payment to a specific (month, year) rent period.
    const allocations = body.allocations as Array<{ month: number; year: number; amount: number; type?: string }> | undefined;
    if (Array.isArray(allocations) && allocations.length > 0) {
      let allocTotal = 0;
      for (const alloc of allocations) {
        if (!Number.isFinite(alloc.amount) || alloc.amount <= 0) {
          return jsonError('Each allocation amount must be a positive number', 400);
        }
        if (!Number.isInteger(alloc.month) || alloc.month < 1 || alloc.month > 12) {
          return jsonError('Each allocation month must be between 1 and 12', 400);
        }
        if (!Number.isInteger(alloc.year) || alloc.year < 2000) {
          return jsonError('Each allocation year is invalid', 400);
        }
        allocTotal += alloc.amount;
      }
      // Allocation total must not exceed payment amount (rounding tolerance).
      if (Math.round(allocTotal * 100) > Math.round(amount * 100)) {
        return jsonError('Allocation total cannot exceed payment amount', 400);
      }
      for (const alloc of allocations) {
        stmts.push(
          env.DB.prepare(
            `INSERT INTO payment_allocations (id, payment_id, lease_id, month, year, amount, type)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
          ).bind(
            crypto.randomUUID(),
            id,
            body.leaseId,
            alloc.month,
            alloc.year,
            alloc.amount,
            alloc.type === 'late_fee' ? 'late_fee' : 'rent'
          )
        );
      }
    }

    // If any allocation targets a late fee, update the matching late_fees record
    // status. This runs in the same batch so the payment + allocation + status
    // update are atomic.
    if (Array.isArray(allocations)) {
      const lateFeeAllocs = allocations.filter(a => a.type === 'late_fee');
      for (const lfa of lateFeeAllocs) {
        // Look up the late fee for this lease+period to decide paid vs partial.
        const existing = await env.DB.prepare(
          'SELECT id, amount, status FROM late_fees WHERE lease_id = ? AND month = ? AND year = ? AND status IN (\'outstanding\', \'partial\')'
        ).bind(body.leaseId, lfa.month, lfa.year).first<{ id: string; amount: number; status: string }>();
        if (existing) {
          const newStatus = lfa.amount >= existing.amount ? 'paid' : 'partial';
          stmts.push(
            env.DB.prepare(
              'UPDATE late_fees SET status = ? WHERE id = ?'
            ).bind(newStatus, existing.id)
          );
        }
      }
    }

    await env.DB.batch(stmts);

    // Fetch allocations for the response.
    const [row, allocRows] = await Promise.all([
      env.DB.prepare('SELECT * FROM rent_payments WHERE id = ?').bind(id).first(),
      env.DB.prepare('SELECT * FROM payment_allocations WHERE payment_id = ? ORDER BY year, month').bind(id).all(),
    ]);
    // A bulk CSV import posts one row at a time with ?deferSheetSync=1: it skips
    // both the per-row spreadsheet rebuild (dozens of redundant rebuilds that
    // could hit the Sheets rate limit; it rebuilds once at the end) AND per-row
    // receipt generation (Belle asked receipts only for payments she records).
    const isBulk = new URL(request.url).searchParams.get('deferSheetSync') === '1';
    if (!isBulk) {
      syncRentSheet(context);
      // Best-effort receipt for a manually recorded paid payment (or credit);
      // never blocks or fails the payment (the database is the record of truth).
      if (body.status === 'paid') {
        context.waitUntil(generateReceipt(env, id, auth.id).catch(() => {}));
      }
    }
    const serializedAllocations = (allocRows?.results || []).map(serializeAllocation);
    return jsonOk({ success: true, data: { ...serializePayment(row as Record<string, unknown>), allocations: serializedAllocations } }, 201);
  } catch {
    return serverError();
  }
};
