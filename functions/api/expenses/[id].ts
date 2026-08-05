import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../lib/session';
import { serializeExpense } from '../../lib/serializers';
import { logActivityStmt } from '../../lib/activity';

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
  const auth = await requirePermission(env, request, 'finances_history');
  if (auth instanceof Response) return auth;

  try {
    const id = params.id as string;
    const before = await env.DB.prepare('SELECT * FROM expenses WHERE id = ?').bind(id).first<Record<string, unknown>>();
    if (!before) return jsonError('Expense not found', 404);

    const body = (await request.json()) as Record<string, unknown>;
    if (!body.category || body.amount === undefined || !body.date || !body.description) {
      return jsonError('Category, amount, date and description are required', 400);
    }
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return jsonError('Amount must be a positive number', 400);
    }

    await env.DB.batch([
      env.DB.prepare(
        `UPDATE expenses SET
          property_id = ?, unit_id = ?, category = ?, amount = ?, date = ?, description = ?, vendor = ?,
          is_recurring = ?, recurring_frequency = ?, interest_amount = ?,
          updated_at = unixepoch()
         WHERE id = ?`
      ).bind(
        body.propertyId ?? null,
        body.unitId ?? null,
        body.category,
        body.amount,
        body.date,
        body.description,
        body.vendor ?? null,
        body.isRecurring ? 1 : 0,
        body.recurringFrequency ?? null,
        body.interestAmount ?? null,
        id
      ),
      logActivityStmt(env.DB, auth, {
        module: 'finances',
        action: 'Updated an expense',
        targetType: 'expenses',
        targetId: id,
        targetName: String(body.description),
        propertyId: (body.propertyId as string) || undefined,
        unitId: (body.unitId as string) || undefined,
        previousValues: { category: before.category, amount: before.amount, date: before.date, description: before.description, vendor: before.vendor },
        newValues: { category: body.category, amount: body.amount, date: body.date, description: body.description, vendor: body.vendor },
      }),
    ]);

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
    const id = params.id as string;
    const before = await env.DB.prepare('SELECT description, amount, category, property_id FROM expenses WHERE id = ?').bind(id)
      .first<{ description: string; amount: number; category: string; property_id: string | null }>();
    await env.DB.batch([
      env.DB.prepare('DELETE FROM expenses WHERE id = ?').bind(id),
      logActivityStmt(env.DB, auth, {
        module: 'finances',
        action: 'Deleted an expense',
        targetType: 'expenses',
        targetId: id,
        targetName: before?.description || undefined,
        description: before ? `$${before.amount} ${before.category}` : undefined,
        propertyId: before?.property_id || undefined,
      }),
    ]);
    return jsonOk({ success: true });
  } catch {
    return serverError();
  }
};
