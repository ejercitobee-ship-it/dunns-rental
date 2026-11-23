import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requireUser, jsonOk, jsonError, serverError } from '../../lib/session';
import { tenantIdForUser } from '../../lib/portal';

/**
 * GET /api/portal/payment-plans — a tenant's own payment plans with installments.
 */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requireUser(env, request);
  if (auth instanceof Response) return auth;
  if (auth.role !== 'tenant') return jsonError('Not a tenant account', 403);

  try {
    const tenantId = await tenantIdForUser(env, auth.id);
    if (!tenantId) return jsonError('No tenant record linked', 404);

    const { results: plans } = await env.DB.prepare(
      `SELECT id, lease_id, total_amount, num_installments, start_date,
              status, reason, created_at, tenant_signature_date
         FROM payment_plans
        WHERE tenant_id = ?
        ORDER BY created_at DESC`
    ).bind(tenantId).all();

    if (!plans || plans.length === 0) {
      return jsonOk({ success: true, data: [] });
    }

    const planIds = plans.map((p: any) => p.id);
    const placeholders = planIds.map(() => '?').join(',');
    const { results: installments } = await env.DB.prepare(
      `SELECT id, plan_id, installment_number, due_date, amount, status, paid_date, paid_amount
         FROM payment_plan_installments
        WHERE plan_id IN (${placeholders})
        ORDER BY installment_number`
    ).bind(...planIds).all();

    const byPlan: Record<string, any[]> = {};
    for (const inst of installments || []) {
      const pid = (inst as any).plan_id;
      if (!byPlan[pid]) byPlan[pid] = [];
      byPlan[pid].push(inst);
    }

    const data = plans.map((p: any) => ({
      ...p,
      installments: byPlan[p.id] || [],
    }));

    return jsonOk({ success: true, data });
  } catch {
    return serverError();
  }
};
