import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../../lib/session';
import { generateRealtorCommissionConfirmation } from '../../../lib/receipts';

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'properties_edit');
  if (auth instanceof Response) return auth;

  try {
    const realtorId = params.id as string;
    const body = (await request.json()) as Record<string, unknown>;
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) return jsonError('Enter a valid amount', 400);

    const description = String(body.description || '').trim();
    if (!description) return jsonError('Enter a description for this commission', 400);

    const propertyId = body.propertyId ? String(body.propertyId) : null;
    const unitId = body.unitId ? String(body.unitId) : null;
    const paymentMethod = body.paymentMethod ? String(body.paymentMethod) : 'bank_transfer';

    const realtor = await env.DB.prepare(
      `SELECT u.id, u.name, u.email, u.company_name
         FROM user u JOIN user_roles ur ON ur.user_id = u.id
        WHERE u.id = ? AND ur.role = 'realtor'`
    ).bind(realtorId).first<{ id: string; name: string; email: string | null; company_name: string | null }>();
    if (!realtor) return jsonError('Realtor not found', 404);

    const today = new Date().toISOString().slice(0, 10);
    const expenseId = crypto.randomUUID();

    await env.DB.prepare(
      `INSERT INTO expenses (id, property_id, unit_id, category, amount, date, description, vendor, is_recurring, user_id)
       VALUES (?, ?, ?, 'realtor_commission', ?, ?, ?, ?, 0, ?)`
    ).bind(
      expenseId,
      propertyId,
      unitId,
      amount,
      today,
      description,
      realtor.company_name || realtor.name,
      auth.id
    ).run();

    context.waitUntil(
      generateRealtorCommissionConfirmation(env, expenseId, realtorId, paymentMethod, auth.id).catch(() => {})
    );

    return jsonOk({ success: true, data: { expenseId } }, 201);
  } catch {
    return serverError();
  }
};
