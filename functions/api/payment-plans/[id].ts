import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../lib/session';
import { logActivityStmt } from '../../lib/activity';

/** GET /api/payment-plans/:id — single plan with installments. */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'rents_view');
  if (auth instanceof Response) return auth;

  try {
    const id = params.id as string;
    const plan = await env.DB.prepare(
      `SELECT pp.*, t.first_name, t.last_name, t.email,
              l.monthly_rent, l.rent_due_day,
              p.name AS property_name, p.address AS property_address,
              u2.unit_number
         FROM payment_plans pp
         LEFT JOIN tenants t ON t.id = pp.tenant_id
         LEFT JOIN leases l ON l.id = pp.lease_id
         LEFT JOIN properties p ON p.id = l.property_id
         LEFT JOIN units u2 ON u2.id = l.unit_id
        WHERE pp.id = ?`
    ).bind(id).first();

    if (!plan) return jsonError('Payment plan not found', 404);

    const { results: installments } = await env.DB.prepare(
      `SELECT * FROM payment_plan_installments WHERE plan_id = ? ORDER BY installment_number`
    ).bind(id).all();

    return jsonOk({ success: true, data: { ...plan, installments: installments || [] } });
  } catch {
    return serverError();
  }
};

/** PUT /api/payment-plans/:id — update plan status or notes. */
export const onRequestPut: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'rents_edit');
  if (auth instanceof Response) return auth;

  try {
    const id = params.id as string;
    const body = await request.json() as {
      status?: string;
      notes?: string;
      tenantSignatureDate?: string;
    };

    const sets: string[] = ['updated_at = unixepoch()'];
    const binds: unknown[] = [];

    if (body.status) {
      if (!['active', 'completed', 'defaulted', 'cancelled'].includes(body.status)) {
        return jsonError('Invalid status', 400);
      }
      sets.push('status = ?');
      binds.push(body.status);
    }
    if (body.notes !== undefined) { sets.push('notes = ?'); binds.push(body.notes); }
    if (body.tenantSignatureDate !== undefined) { sets.push('tenant_signature_date = ?'); binds.push(body.tenantSignatureDate); }

    binds.push(id);

    const plan = await env.DB.prepare(
      `SELECT pp.tenant_id, t.first_name, t.last_name FROM payment_plans pp LEFT JOIN tenants t ON t.id = pp.tenant_id WHERE pp.id = ?`
    ).bind(id).first<{ tenant_id: string | null; first_name: string | null; last_name: string | null }>();

    await env.DB.batch([
      env.DB.prepare(
        `UPDATE payment_plans SET ${sets.join(', ')} WHERE id = ?`
      ).bind(...binds),
      logActivityStmt(env.DB, auth, {
        module: 'finances',
        action: body.status ? `Updated payment plan status to ${body.status}` : 'Updated a payment plan',
        targetType: 'payment-plans',
        targetId: id,
        tenantId: plan?.tenant_id || undefined,
        targetName: plan ? [plan.first_name, plan.last_name].filter(Boolean).join(' ') : undefined,
        newValues: body,
      }),
    ]);

    return jsonOk({ success: true });
  } catch {
    return serverError();
  }
};

/** DELETE /api/payment-plans/:id — delete a plan (admin only, before any payments). */
export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'rents_edit');
  if (auth instanceof Response) return auth;

  try {
    const id = params.id as string;

    const hasPaid = await env.DB.prepare(
      `SELECT 1 FROM payment_plan_installments WHERE plan_id = ? AND status = 'paid' LIMIT 1`
    ).bind(id).first();

    if (hasPaid) {
      return jsonError('Cannot delete a plan that has paid installments. Cancel it instead.', 400);
    }

    const planInfo = await env.DB.prepare(
      `SELECT pp.tenant_id, pp.total_amount, t.first_name, t.last_name FROM payment_plans pp LEFT JOIN tenants t ON t.id = pp.tenant_id WHERE pp.id = ?`
    ).bind(id).first<{ tenant_id: string | null; total_amount: number; first_name: string | null; last_name: string | null }>();

    await env.DB.batch([
      env.DB.prepare('DELETE FROM payment_plan_installments WHERE plan_id = ?').bind(id),
      env.DB.prepare('DELETE FROM payment_plans WHERE id = ?').bind(id),
      logActivityStmt(env.DB, auth, {
        module: 'finances',
        action: 'Deleted a payment plan',
        targetType: 'payment-plans',
        targetId: id,
        tenantId: planInfo?.tenant_id || undefined,
        targetName: planInfo ? [planInfo.first_name, planInfo.last_name].filter(Boolean).join(' ') : undefined,
        description: planInfo ? `$${planInfo.total_amount.toFixed(2)} plan` : undefined,
      }),
    ]);

    return jsonOk({ success: true });
  } catch {
    return serverError();
  }
};
