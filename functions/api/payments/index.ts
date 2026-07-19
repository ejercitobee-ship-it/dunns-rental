import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../lib/session';
import { serializePayment } from '../../lib/serializers';
import { syncRentSheet } from '../../lib/sheets';

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
        body.notes ?? null
      )
      .run();

    const row = await env.DB.prepare('SELECT * FROM rent_payments WHERE id = ?').bind(id).first();
    // A bulk CSV import posts one row at a time with ?deferSheetSync=1 so it
    // does NOT rebuild the whole spreadsheet on every row (dozens of redundant
    // rebuilds that could hit the Sheets rate limit); it triggers one rebuild
    // itself after the last row.
    if (new URL(request.url).searchParams.get('deferSheetSync') !== '1') {
      syncRentSheet(context);
    }
    return jsonOk({ success: true, data: serializePayment(row as Record<string, unknown>) }, 201);
  } catch {
    return serverError();
  }
};
