import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../lib/session';
import { serializeIncome } from '../../lib/serializers';

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requirePermission(env, request, 'finances_view');
  if (auth instanceof Response) return auth;

  try {
    const { results } = await env.DB.prepare(
      'SELECT * FROM incomes ORDER BY created_at DESC'
    ).all();
    return jsonOk({ success: true, data: (results || []).map(serializeIncome) });
  } catch {
    return serverError();
  }
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requirePermission(env, request, 'finances_income');
  if (auth instanceof Response) return auth;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    if (!body.source || body.amount === undefined || !body.date || !body.description) {
      return jsonError('Source, amount, date and description are required', 400);
    }
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return jsonError('Amount must be a positive number', 400);
    }

    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO incomes (id, property_id, unit_id, source, amount, date, description, related_payment_id, user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        id,
        body.propertyId ?? null,
        body.unitId ?? null,
        body.source,
        body.amount,
        body.date,
        body.description,
        body.relatedPaymentId ?? null,
        auth.id
      )
      .run();

    const row = await env.DB.prepare('SELECT * FROM incomes WHERE id = ?').bind(id).first();
    return jsonOk({ success: true, data: serializeIncome(row as Record<string, unknown>) }, 201);
  } catch {
    return serverError();
  }
};
