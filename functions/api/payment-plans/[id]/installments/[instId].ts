import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../../../lib/session';
import { logActivityStmt } from '../../../../lib/activity';

/** PUT /api/payment-plans/:id/installments/:instId — mark an installment paid/missed. */
export const onRequestPut: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'rents_edit');
  if (auth instanceof Response) return auth;

  try {
    const planId = params.id as string;
    const instId = params.instId as string;
    const body = await request.json() as {
      status: 'paid' | 'missed' | 'pending';
      paidDate?: string;
      paidAmount?: number;
      notes?: string;
    };

    if (!['paid', 'missed', 'pending'].includes(body.status)) {
      return jsonError('status must be paid, missed, or pending', 400);
    }

    const sets: string[] = ['status = ?', 'updated_at = unixepoch()'];
    const binds: unknown[] = [body.status];

    if (body.status === 'paid') {
      sets.push('paid_date = ?');
      binds.push(body.paidDate || new Date().toISOString().slice(0, 10));
      if (body.paidAmount !== undefined) {
        sets.push('paid_amount = ?');
        binds.push(body.paidAmount);
      }
    }
    if (body.notes !== undefined) { sets.push('notes = ?'); binds.push(body.notes); }

    binds.push(instId, planId);
    const { meta } = await env.DB.prepare(
      `UPDATE payment_plan_installments SET ${sets.join(', ')} WHERE id = ? AND plan_id = ?`
    ).bind(...binds).run();

    if (!meta?.changes) return jsonError('Installment not found', 404);

    const instInfo = await env.DB.prepare(
      `SELECT i.installment_number, i.amount, pp.tenant_id, t.first_name, t.last_name
         FROM payment_plan_installments i
         JOIN payment_plans pp ON pp.id = i.plan_id
         LEFT JOIN tenants t ON t.id = pp.tenant_id
        WHERE i.id = ?`
    ).bind(instId).first<{ installment_number: number; amount: number; tenant_id: string | null; first_name: string | null; last_name: string | null }>();

    await logActivityStmt(env.DB, auth, {
      module: 'finances',
      action: `Marked installment #${instInfo?.installment_number || '?'} as ${body.status}`,
      targetType: 'payment-plans',
      targetId: planId,
      tenantId: instInfo?.tenant_id || undefined,
      targetName: instInfo ? [instInfo.first_name, instInfo.last_name].filter(Boolean).join(' ') : undefined,
      description: instInfo ? `$${instInfo.amount.toFixed(2)} installment` : undefined,
      newValues: { status: body.status, paidDate: body.paidDate, paidAmount: body.paidAmount },
    }).run();

    // Auto-complete the plan if all installments are paid.
    const remaining = await env.DB.prepare(
      `SELECT COUNT(*) as cnt FROM payment_plan_installments WHERE plan_id = ? AND status != 'paid'`
    ).bind(planId).first<{ cnt: number }>();

    if (remaining && remaining.cnt === 0) {
      await env.DB.batch([
        env.DB.prepare(
          `UPDATE payment_plans SET status = 'completed', updated_at = unixepoch() WHERE id = ? AND status = 'active'`
        ).bind(planId),
        logActivityStmt(env.DB, auth, {
          module: 'finances',
          action: 'Payment plan auto-completed (all installments paid)',
          targetType: 'payment-plans',
          targetId: planId,
          tenantId: instInfo?.tenant_id || undefined,
          targetName: instInfo ? [instInfo.first_name, instInfo.last_name].filter(Boolean).join(' ') : undefined,
        }),
      ]);
    }

    return jsonOk({ success: true });
  } catch {
    return serverError();
  }
};
