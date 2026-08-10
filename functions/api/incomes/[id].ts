import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../lib/session';
import { serializeIncome } from '../../lib/serializers';

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'finances_view');
  if (auth instanceof Response) return auth;

  try {
    const row = await env.DB.prepare('SELECT * FROM incomes WHERE id = ?')
      .bind(params.id as string)
      .first();
    if (!row) return jsonError('Income not found', 404);
    return jsonOk({ success: true, data: serializeIncome(row as Record<string, unknown>) });
  } catch {
    return serverError();
  }
};

export const onRequestPut: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'finances_income');
  if (auth instanceof Response) return auth;

  try {
    const id = params.id as string;
    const body = (await request.json()) as Record<string, unknown>;

    await env.DB.prepare(
      `UPDATE incomes SET
        property_id = ?, unit_id = ?, tenant_id = ?, source = ?, amount = ?, date = ?, description = ?, related_payment_id = ?,
        updated_at = unixepoch()
       WHERE id = ?`
    )
      .bind(
        body.propertyId ?? null,
        body.unitId ?? null,
        body.tenantId ?? null,
        body.source,
        body.amount,
        body.date,
        body.description,
        body.relatedPaymentId ?? null,
        id
      )
      .run();

    const row = await env.DB.prepare('SELECT * FROM incomes WHERE id = ?').bind(id).first();
    if (!row) return jsonError('Income not found', 404);
    return jsonOk({ success: true, data: serializeIncome(row as Record<string, unknown>) });
  } catch {
    return serverError();
  }
};

export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'finances_income');
  if (auth instanceof Response) return auth;

  try {
    await env.DB.prepare('DELETE FROM incomes WHERE id = ?').bind(params.id as string).run();
    return jsonOk({ success: true });
  } catch {
    return serverError();
  }
};
