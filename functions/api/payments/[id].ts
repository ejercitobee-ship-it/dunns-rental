import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../lib/session';
import { serializePayment } from '../../lib/serializers';

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

    await env.DB.prepare(
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
      )
      .run();

    const row = await env.DB.prepare('SELECT * FROM rent_payments WHERE id = ?').bind(id).first();
    if (!row) return jsonError('Payment not found', 404);
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
    await env.DB.prepare('DELETE FROM rent_payments WHERE id = ?').bind(params.id as string).run();
    return jsonOk({ success: true });
  } catch {
    return serverError();
  }
};
