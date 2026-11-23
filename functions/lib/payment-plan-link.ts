import type { Env } from './session';

/**
 * When a rent payment is recorded (manual or Stripe), check if the tenant
 * has an active payment plan with a pending installment due in the same
 * month. If so, auto-mark that installment as paid.
 *
 * Best-effort: failures here never block the payment itself.
 */
export async function linkPaymentToInstallment(
  env: Env,
  leaseId: string,
  paymentMonth: number,
  paymentYear: number,
  paidDate: string
): Promise<{ planId: string; installmentId: string } | null> {
  const plan = await env.DB.prepare(
    `SELECT pp.id FROM payment_plans pp
      WHERE pp.lease_id = ? AND pp.status = 'active'
      LIMIT 1`
  ).bind(leaseId).first<{ id: string }>();

  if (!plan) return null;

  // Find the next pending installment whose due date falls in the payment month/year.
  const inst = await env.DB.prepare(
    `SELECT id, due_date, amount FROM payment_plan_installments
      WHERE plan_id = ? AND status = 'pending'
        AND CAST(substr(due_date, 6, 2) AS INTEGER) = ?
        AND CAST(substr(due_date, 1, 4) AS INTEGER) = ?
      ORDER BY installment_number ASC LIMIT 1`
  ).bind(plan.id, paymentMonth, paymentYear).first<{ id: string; due_date: string; amount: number }>();

  if (!inst) return null;

  await env.DB.prepare(
    `UPDATE payment_plan_installments
        SET status = 'paid', paid_date = ?, paid_amount = ?, updated_at = unixepoch()
      WHERE id = ? AND status = 'pending'`
  ).bind(paidDate, inst.amount, inst.id).run();

  // Check if all installments are now paid and auto-complete the plan.
  const remaining = await env.DB.prepare(
    `SELECT COUNT(*) as cnt FROM payment_plan_installments
      WHERE plan_id = ? AND status != 'paid'`
  ).bind(plan.id).first<{ cnt: number }>();

  if (remaining && remaining.cnt === 0) {
    await env.DB.prepare(
      `UPDATE payment_plans SET status = 'completed', updated_at = unixepoch()
        WHERE id = ? AND status = 'active'`
    ).bind(plan.id).run();
  }

  return { planId: plan.id, installmentId: inst.id };
}
