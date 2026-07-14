import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../lib/session';
import { serializeExpense } from '../../lib/serializers';

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requirePermission(env, request, 'finances_view');
  if (auth instanceof Response) return auth;

  try {
    const { results } = await env.DB.prepare(
      'SELECT * FROM expenses ORDER BY created_at DESC'
    ).all();
    return jsonOk({ success: true, data: (results || []).map(serializeExpense) });
  } catch {
    return serverError();
  }
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requirePermission(env, request, 'finances_expenses');
  if (auth instanceof Response) return auth;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    if (!body.category || body.amount === undefined || !body.date || !body.description) {
      return jsonError('Category, amount, date and description are required', 400);
    }

    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO expenses (id, property_id, unit_id, category, amount, date, description, vendor, is_recurring, recurring_frequency, user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        id,
        body.propertyId ?? null,
        body.unitId ?? null,
        body.category,
        body.amount,
        body.date,
        body.description,
        body.vendor ?? null,
        body.isRecurring ? 1 : 0,
        body.recurringFrequency ?? null,
        auth.id
      )
      .run();

    const row = await env.DB.prepare('SELECT * FROM expenses WHERE id = ?').bind(id).first();
    return jsonOk({ success: true, data: serializeExpense(row as Record<string, unknown>) }, 201);
  } catch {
    return serverError();
  }
};
