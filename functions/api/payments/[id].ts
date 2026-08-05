import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../lib/session';
import { serializePayment } from '../../lib/serializers';
import { syncRentSheet } from '../../lib/sheets';
import { deleteDriveFile } from '../../lib/google';
import { logActivityStmt } from '../../lib/activity';

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'rents_view');
  if (auth instanceof Response) return auth;

  try {
    const row = await env.DB.prepare('SELECT * FROM rent_payments WHERE id = ?')
      .bind(params.id as string)
      .first();
    if (!row) return jsonError('Payment not found', 404);
    return jsonOk({ success: true, data: serializePayment(row as Record<string, unknown>) });
  } catch {
    return serverError();
  }
};

export const onRequestPut: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'rents_edit');
  if (auth instanceof Response) return auth;

  try {
    const id = params.id as string;
    const before = await env.DB.prepare('SELECT * FROM rent_payments WHERE id = ?').bind(id).first<Record<string, unknown>>();
    if (!before) return jsonError('Payment not found', 404);

    const body = (await request.json()) as Record<string, unknown>;
    // lease_id is NOT NULL: reject a payment with no lease here rather than
    // letting D1 raise a raw constraint error.
    if (!body.leaseId) return jsonError('A lease is required', 400);
    if (body.amount === undefined || body.amount === null) {
      return jsonError('Amount is required', 400);
    }
    // month and year are nullable columns, so without this check a payment
    // could be updated to have neither. serializePayment then returns
    // month: null typed as number, paymentsForMonth never matches it on any
    // month, and the payment sits in the database invisible on every screen.
    if (body.month === undefined || body.month === null) {
      return jsonError('Month is required', 400);
    }
    if (body.year === undefined || body.year === null) {
      return jsonError('Year is required', 400);
    }

    await env.DB.batch([
      env.DB.prepare(
        `UPDATE rent_payments SET
          lease_id = ?, paid_by_tenant_id = ?, amount = ?, due_date = ?, paid_date = ?,
          received_date = ?, status = ?, month = ?, year = ?, payment_method = ?,
          uploaded_by = ?, uploaded_at = ?, notes = ?, updated_at = unixepoch()
         WHERE id = ?`
      )
        .bind(
          body.leaseId,
          body.paidByTenantId ?? null,
          body.amount,
          body.dueDate ?? null,
          body.paidDate ?? null,
          body.receivedDate ?? null,
          body.status ?? 'pending',
          body.month,
          body.year,
          body.paymentMethod ?? null,
          body.uploadedBy ?? null,
          body.uploadedAt ?? null,
          body.notes ?? null,
          id
        ),
      logActivityStmt(env.DB, auth, {
        module: 'finances',
        action: 'Updated a rent payment',
        targetType: 'payments',
        targetId: id,
        description: `$${body.amount} for ${body.month}/${body.year}`,
        previousValues: { amount: before.amount, status: before.status, month: before.month, year: before.year },
        newValues: { amount: body.amount, status: body.status ?? 'pending', month: body.month, year: body.year },
      }),
    ]);

    const row = await env.DB.prepare('SELECT * FROM rent_payments WHERE id = ?').bind(id).first();
    if (!row) return jsonError('Payment not found', 404);
    syncRentSheet(context);
    return jsonOk({ success: true, data: serializePayment(row as Record<string, unknown>) });
  } catch {
    return serverError();
  }
};

export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'rents_edit');
  if (auth instanceof Response) return auth;

  try {
    const id = params.id as string;

    // If this payment had an auto-generated receipt, clean it up too: remove the
    // PDF from Drive and the documents row, so a deleted payment leaves no
    // orphaned receipt behind. Best-effort on the Drive side.
    const payment = await env.DB.prepare('SELECT receipt_document_id FROM rent_payments WHERE id = ?')
      .bind(id)
      .first<{ receipt_document_id: string | null }>();
    if (payment?.receipt_document_id) {
      const doc = await env.DB.prepare('SELECT drive_file_id FROM documents WHERE id = ?')
        .bind(payment.receipt_document_id)
        .first<{ drive_file_id: string | null }>();
      if (doc?.drive_file_id) {
        try { await deleteDriveFile(env, doc.drive_file_id); } catch { /* already gone or Drive down */ }
      }
      await env.DB.prepare('DELETE FROM documents WHERE id = ?').bind(payment.receipt_document_id).run();
    }

    const paymentInfo = await env.DB.prepare('SELECT amount, month, year, status FROM rent_payments WHERE id = ?')
      .bind(id).first<{ amount: number; month: number; year: number; status: string }>();
    await env.DB.batch([
      env.DB.prepare('DELETE FROM rent_payments WHERE id = ?').bind(id),
      logActivityStmt(env.DB, auth, {
        module: 'finances',
        action: 'Deleted a rent payment',
        targetType: 'payments',
        targetId: id,
        description: paymentInfo ? `$${paymentInfo.amount} for ${paymentInfo.month}/${paymentInfo.year}` : undefined,
      }),
    ]);
    syncRentSheet(context);
    return jsonOk({ success: true });
  } catch {
    return serverError();
  }
};
