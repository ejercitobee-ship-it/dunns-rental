import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../lib/session';
import { serializePayment } from '../../lib/serializers';

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
    if (body.amount === undefined || body.amount === null) {
      return jsonError('Amount is required', 400);
    }

    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO rent_payments (id, lease_id, paid_by_tenant_id, amount, due_date, paid_date,
        received_date, status, month, year, payment_method, uploaded_by, uploaded_at, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        id,
        body.leaseId,
        body.paidByTenantId ?? null,
        body.amount,
        body.dueDate ?? null,
        body.paidDate ?? null,
        body.receivedDate ?? null,
        body.status ?? 'pending',
        body.month ?? null,
        body.year ?? null,
        body.paymentMethod ?? null,
        body.uploadedBy ?? auth.id,
        body.uploadedAt ?? null,
        body.notes ?? null
      )
      .run();

    const row = await env.DB.prepare('SELECT * FROM rent_payments WHERE id = ?').bind(id).first();
    return jsonOk({ success: true, data: serializePayment(row as Record<string, unknown>) }, 201);
  } catch {
    return serverError();
  }
};
