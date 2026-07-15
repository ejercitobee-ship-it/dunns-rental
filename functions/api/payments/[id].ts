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

    await env.DB.prepare(
      `UPDATE rent_payments SET
        lease_id = ?, paid_by_tenant_id = ?, amount = ?, due_date = ?, paid_date = ?,
        received_date = ?, status = ?, month = ?, year = ?, payment_method = ?,
        uploaded_by = ?, uploaded_at = ?, notes = ?, updated_at = unixepoch()
       WHERE id = ?`
    )
      .bind(
        body.leaseId ?? null,
        body.paidByTenantId ?? null,
        body.amount,
        body.dueDate ?? null,
        body.paidDate ?? null,
        body.receivedDate ?? null,
        body.status ?? 'pending',
        body.month ?? null,
        body.year ?? null,
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
