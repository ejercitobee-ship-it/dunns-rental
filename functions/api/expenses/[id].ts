import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../lib/session';
import { serializeExpense } from '../../lib/serializers';

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'finances_view');
  if (auth instanceof Response) return auth;

  try {
    const row = await env.DB.prepare('SELECT * FROM expenses WHERE id = ?')
      .bind(params.id as string)
      .first();
    if (!row) return jsonError('Expense not found', 404);
    return jsonOk({ success: true, data: serializeExpense(row as Record<string, unknown>) });
  } catch {
    return serverError();
  }
};

export const onRequestPut: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'finances_expenses');
  if (auth instanceof Response) return auth;

  try {
    const id = params.id as string;
    const body = (await request.json()) as Record<string, unknown>;

    await env.DB.prepare(
      `UPDATE expenses SET
        property_id = ?, unit_id = ?, category = ?, amount = ?, date = ?, description = ?, vendor = ?,
        is_recurring = ?, recurring_frequency = ?,
        updated_at = unixepoch()
       WHERE id = ?`
    )
      .bind(
        body.propertyId ?? null,
        body.unitId ?? null,
        body.category,
        body.amount,
        body.date,
        body.description,
        body.vendor ?? null,
        body.isRecurring ? 1 : 0,
        body.recurringFrequency ?? null,
        id
      )
      .run();

    const row = await env.DB.prepare('SELECT * FROM expenses WHERE id = ?').bind(id).first();
    if (!row) return jsonError('Expense not found', 404);
    return jsonOk({ success: true, data: serializeExpense(row as Record<string, unknown>) });
  } catch {
    return serverError();
  }
};

export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'finances_expenses');
  if (auth instanceof Response) return auth;

  try {
    await env.DB.prepare('DELETE FROM expenses WHERE id = ?').bind(params.id as string).run();
    return jsonOk({ success: true });
  } catch {
    return serverError();
  }
};
