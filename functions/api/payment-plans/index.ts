import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../lib/session';
import { sendEmail, paymentPlanCreatedEmail } from '../../lib/email';
import { sendPushToUser } from '../../lib/push';
import { SITE_URL } from '../../lib/site';
import { logActivityStmt } from '../../lib/activity';

/** GET /api/payment-plans — list payment plans, optionally filtered. */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requirePermission(env, request, 'rents_view');
  if (auth instanceof Response) return auth;

  try {
    const url = new URL(request.url);
    const tenantId = url.searchParams.get('tenantId');
    const leaseId = url.searchParams.get('leaseId');
    const status = url.searchParams.get('status');

    const clauses: string[] = [];
    const binds: unknown[] = [];

    if (tenantId) { clauses.push('pp.tenant_id = ?'); binds.push(tenantId); }
    if (leaseId) { clauses.push('pp.lease_id = ?'); binds.push(leaseId); }
    if (status) { clauses.push('pp.status = ?'); binds.push(status); }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

    const { results: plans } = await env.DB.prepare(
      `SELECT pp.*, t.first_name, t.last_name, u.name AS created_by_name
         FROM payment_plans pp
         LEFT JOIN tenants t ON t.id = pp.tenant_id
         LEFT JOIN user u ON u.id = pp.created_by
        ${where}
        ORDER BY pp.created_at DESC`
    ).bind(...binds).all();

    const planIds = (plans || []).map((p: any) => p.id);
    let installmentsByPlan: Record<string, any[]> = {};

    if (planIds.length > 0) {
      const placeholders = planIds.map(() => '?').join(',');
      const { results: installments } = await env.DB.prepare(
        `SELECT * FROM payment_plan_installments WHERE plan_id IN (${placeholders}) ORDER BY installment_number`
      ).bind(...planIds).all();

      for (const inst of installments || []) {
        const pid = (inst as any).plan_id;
        if (!installmentsByPlan[pid]) installmentsByPlan[pid] = [];
        installmentsByPlan[pid].push(inst);
      }
    }

    const data = (plans || []).map((p: any) => ({
      ...p,
      installments: installmentsByPlan[p.id] || [],
    }));

    return jsonOk({ success: true, data });
  } catch (err) {
    console.error('payment-plans GET error:', err);
    return serverError();
  }
};

/** POST /api/payment-plans — create a new payment plan with installments. */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requirePermission(env, request, 'rents_edit');
  if (auth instanceof Response) return auth;

  try {
    const body = await request.json() as {
      leaseId: string;
      tenantId: string;
      totalAmount: number;
      reason?: string;
      notes?: string;
      installments: { dueDate: string; amount: number }[];
    };

    if (!body.leaseId || !body.tenantId || !body.totalAmount || !body.installments?.length) {
      return jsonError('leaseId, tenantId, totalAmount, and installments are required', 400);
    }

    const planId = crypto.randomUUID();
    const startDate = body.installments[0].dueDate;

    const stmts = [
      env.DB.prepare(
        `INSERT INTO payment_plans (id, lease_id, tenant_id, created_by, total_amount, num_installments, start_date, reason, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        planId, body.leaseId, body.tenantId, (auth as any).id,
        body.totalAmount, body.installments.length, startDate,
        body.reason || null, body.notes || null
      ),
    ];

    for (let i = 0; i < body.installments.length; i++) {
      const inst = body.installments[i];
      stmts.push(
        env.DB.prepare(
          `INSERT INTO payment_plan_installments (id, plan_id, installment_number, due_date, amount)
           VALUES (?, ?, ?, ?, ?)`
        ).bind(crypto.randomUUID(), planId, i + 1, inst.dueDate, inst.amount)
      );
    }

    stmts.push(logActivityStmt(env.DB, auth, {
      module: 'finances',
      action: 'Created a payment plan',
      targetType: 'payment-plans',
      targetId: planId,
      tenantId: body.tenantId,
      description: `$${body.totalAmount.toFixed(2)} in ${body.installments.length} installments`,
      newValues: { totalAmount: body.totalAmount, numInstallments: body.installments.length, reason: body.reason || null },
    }));

    await env.DB.batch(stmts);

    // Notify the tenant via email and push (best effort, don't fail the create).
    try {
      const tenant = await env.DB.prepare(
        `SELECT t.first_name, t.email, t.user_id
           FROM tenants t WHERE t.id = ?`
      ).bind(body.tenantId).first<{ first_name: string | null; email: string | null; user_id: string | null }>();

      if (tenant?.email) {
        const firstDue = body.installments[0].dueDate;
        const { html, text, subject } = paymentPlanCreatedEmail({
          name: tenant.first_name || 'Tenant',
          totalAmount: body.totalAmount,
          numInstallments: body.installments.length,
          firstDueDate: firstDue,
          reason: body.reason,
          portalUrl: `${SITE_URL}/portal/payments`,
          pdfUrl: `${SITE_URL}/api/payment-plans/${planId}/generate-pdf`,
        });
        await sendEmail(env, { to: tenant.email, subject, html, text });
      }

      if (tenant?.user_id) {
        await sendPushToUser(env, tenant.user_id, {
          title: 'Payment Plan Created',
          body: `A payment plan for $${body.totalAmount.toFixed(2)} has been set up on your account.`,
          url: `${SITE_URL}/portal/payments`,
        }).catch(() => {});
      }
    } catch (notifyErr) {
      console.error('payment-plan notify error (non-fatal):', notifyErr);
    }

    return jsonOk({ success: true, id: planId });
  } catch (err) {
    console.error('payment-plans POST error:', err);
    return serverError();
  }
};
