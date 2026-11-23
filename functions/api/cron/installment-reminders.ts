import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, getSessionUser, jsonOk, jsonError, serverError, constantTimeStrEqual } from '../../lib/session';
import { sendEmail, installmentReminderEmail } from '../../lib/email';
import { sendPushToUser } from '../../lib/push';
import { SITE_URL } from '../../lib/site';

function chicagoDateStr(): string {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/**
 * POST /api/cron/installment-reminders — send reminders for installments
 * due in 3 days. Runs daily via the rent-reminder worker.
 */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;

  const auth = request.headers.get('Authorization') || '';
  const presented = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  const cronOk = !!env.CRON_SECRET && constantTimeStrEqual(presented, env.CRON_SECRET);
  if (!cronOk) {
    const user = await getSessionUser(env, request);
    if (!user) return jsonError('Not authorized', 401);
    const canTrigger = user.role === 'super_admin' ||
      (user.permissions ? user.permissions.includes('settings_edit') : false);
    if (!canTrigger) return jsonError('Not authorized', 401);
  }

  try {
    const today = chicagoDateStr();
    const todayDate = new Date(today + 'T12:00:00');
    const target = new Date(todayDate.getTime() + 3 * 24 * 60 * 60 * 1000);
    const targetStr = target.toISOString().slice(0, 10);

    const { results: upcoming } = await env.DB.prepare(
      `SELECT ppi.id AS inst_id, ppi.installment_number, ppi.due_date, ppi.amount,
              pp.id AS plan_id, pp.total_amount, pp.tenant_id,
              t.first_name, t.email, t.user_id
         FROM payment_plan_installments ppi
         JOIN payment_plans pp ON pp.id = ppi.plan_id
         JOIN tenants t ON t.id = pp.tenant_id
        WHERE ppi.due_date = ?
          AND ppi.status = 'pending'
          AND pp.status = 'active'`
    ).bind(targetStr).all<{
      inst_id: string; installment_number: number; due_date: string; amount: number;
      plan_id: string; total_amount: number; tenant_id: string;
      first_name: string | null; email: string | null; user_id: string | null;
    }>();

    let sent = 0;
    for (const row of upcoming || []) {
      const paidSoFar = await env.DB.prepare(
        `SELECT COALESCE(SUM(paid_amount), 0) AS paid
           FROM payment_plan_installments
          WHERE plan_id = ? AND status = 'paid'`
      ).bind(row.plan_id).first<{ paid: number }>();
      const remaining = row.total_amount - (paidSoFar?.paid ?? 0);

      if (row.email) {
        const { html, text, subject } = installmentReminderEmail({
          name: row.first_name || 'Tenant',
          installmentNumber: row.installment_number,
          amount: row.amount,
          dueDate: row.due_date,
          totalRemaining: remaining,
          portalUrl: `${SITE_URL}/portal/payments`,
        });
        const ok = await sendEmail(env, { to: row.email, subject, html, text });
        if (ok) sent++;
      }

      if (row.user_id) {
        await sendPushToUser(env, row.user_id, {
          title: 'Payment Plan Reminder',
          body: `Installment #${row.installment_number} of $${row.amount.toFixed(2)} is due on ${row.due_date}.`,
          url: `${SITE_URL}/portal/payments`,
        }).catch(() => {});
      }
    }

    return jsonOk({ success: true, found: (upcoming || []).length, sent });
  } catch (err) {
    console.error('installment-reminders error:', err);
    return serverError();
  }
};
