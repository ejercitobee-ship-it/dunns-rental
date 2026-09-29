import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, getSessionUser, jsonOk, jsonError, serverError, constantTimeStrEqual } from '../../lib/session';
import { getSetting } from '../../lib/google';
import { getStripe } from '../../lib/stripe';
import { sendPushToUser } from '../../lib/push';
import { sendEmail } from '../../lib/email';
import { SITE_URL } from '../../lib/site';
import { achFee } from '../../lib/stripe-fee';

/**
 * POST /api/cron/autopay — charge rent automatically for tenants who opted in.
 * Runs on the rent due day, right after (or alongside) the rent-due reminder.
 */

interface AutopayTenant {
  user_id: string;
  tenant_id: string;
  first_name: string | null;
  email: string | null;
  lease_id: string;
  monthly_rent: number;
  autopay_payment_method_id: string;
  stripe_customer_id: string;
  lease_due_day: number | null;
}

function chicagoNow(): { day: number; month: number; year: number; monthLabel: string } {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const month = Number(get('month'));
  const year = Number(get('year'));
  const day = Number(get('day'));
  const monthLabel = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    month: 'long',
    year: 'numeric',
  }).format(now);
  return { day, month, year, monthLabel };
}

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

  if (!env.STRIPE_SECRET_KEY) {
    return jsonOk({ success: true, skipped: 'Stripe not configured' });
  }

  try {
    const rentRaw = await getSetting(env, 'rent');
    let globalDueDay = 1;
    if (rentRaw) {
      try {
        const r = JSON.parse(rentRaw) as { rentDueDay?: number };
        if (typeof r.rentDueDay === 'number' && r.rentDueDay >= 1 && r.rentDueDay <= 31) {
          globalDueDay = Math.floor(r.rentDueDay);
        }
      } catch { /* defaults */ }
    }

    const { day, month, year, monthLabel } = chicagoNow();

    const { results: rows } = await env.DB.prepare(
      `SELECT u.id AS user_id, t.id AS tenant_id, t.first_name, t.email,
              l.id AS lease_id, l.monthly_rent, l.rent_due_day AS lease_due_day,
              u.autopay_payment_method_id, u.stripe_customer_id
         FROM user u
         JOIN tenants t ON t.user_id = u.id
         JOIN lease_tenants lt ON lt.tenant_id = t.id
         JOIN leases l ON l.id = lt.lease_id
        WHERE u.autopay_enabled = 1
          AND u.autopay_payment_method_id IS NOT NULL
          AND u.stripe_customer_id IS NOT NULL
          AND l.status = 'active'`
    ).all<AutopayTenant>();

    const eligible = (rows || []).filter(r => {
      const effectiveDay = r.lease_due_day ?? globalDueDay;
      return effectiveDay === day;
    });

    if (eligible.length === 0) {
      return jsonOk({ success: true, charged: 0, skipped: 'no autopay tenants due today' });
    }

    const stripe = getStripe(env);
    let charged = 0;
    let failed = 0;

    for (const tenant of eligible) {
      try {
        const existing = await env.DB.prepare(
          `SELECT id FROM rent_payments
           WHERE lease_id = ? AND month = ? AND year = ?
             AND status IN ('paid', 'processing')
             AND type = 'payment'`
        ).bind(tenant.lease_id, month, year).first();
        if (existing) continue;

        const rentAmount = tenant.monthly_rent;
        const fee = achFee(rentAmount);
        const totalAmount = rentAmount + fee;
        const amountCents = Math.round(totalAmount * 100);

        const pi = await stripe.paymentIntents.create({
          amount: amountCents,
          currency: 'usd',
          customer: tenant.stripe_customer_id,
          payment_method: tenant.autopay_payment_method_id,
          payment_method_types: ['us_bank_account'],
          confirm: true,
          mandate_data: {
            customer_acceptance: {
              type: 'online',
              online: {
                ip_address: '0.0.0.0',
                user_agent: 'MH Dunn Property Autopay',
              },
            },
          },
          metadata: {
            leaseId: tenant.lease_id,
            tenantId: tenant.tenant_id,
            month: String(month),
            year: String(year),
            userId: tenant.user_id,
            autopay: 'true',
            rentAmount: String(rentAmount),
            processingFee: String(fee),
          },
        });

        const paymentId = crypto.randomUUID();
        await env.DB.prepare(
          `INSERT INTO rent_payments (id, lease_id, paid_by_tenant_id, amount, paid_date, status, month, year,
            payment_method, uploaded_by, uploaded_at, type, stripe_payment_intent_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          paymentId, tenant.lease_id, tenant.tenant_id, rentAmount,
          new Date().toISOString().slice(0, 10), 'processing',
          month, year, 'bank_transfer', tenant.user_id,
          new Date().toISOString(), 'payment', pi.id,
        ).run();

        charged++;

        try {
          await sendPushToUser(env, tenant.user_id, {
            title: 'Autopay: rent submitted',
            body: `Your ${monthLabel} rent of ${formatDollar(totalAmount)} (includes ${formatDollar(fee)} processing fee) has been submitted.`,
            url: '/portal/payments',
          });
        } catch { /* non-critical */ }

        try {
          if (tenant.email) {
            await sendEmail(env, {
              to: tenant.email,
              subject: `Autopay: ${monthLabel} rent submitted`,
              text: `Hi ${tenant.first_name || 'there'}, your autopay for ${monthLabel} has been submitted. Rent: ${formatDollar(rentAmount)}, Processing fee: ${formatDollar(fee)}, Total: ${formatDollar(totalAmount)}. ACH transfers typically take 3 to 5 business days to settle.`,
              html: `<p>Hi ${tenant.first_name || 'there'},</p>
<p>Your autopay for ${monthLabel} has been submitted.</p>
<p>Rent: ${formatDollar(rentAmount)}<br>Processing fee: ${formatDollar(fee)}<br><strong>Total: ${formatDollar(totalAmount)}</strong></p>
<p>ACH transfers typically take 3 to 5 business days to settle.</p>
<p><a href="${SITE_URL}/portal/payments">View your payments</a></p>`,
            });
          }
        } catch { /* non-critical */ }
      } catch (err) {
        console.error(`autopay: failed for tenant ${tenant.tenant_id}: ${(err as Error).message}`);
        failed++;

        try {
          await sendPushToUser(env, tenant.user_id, {
            title: 'Autopay: payment failed',
            body: `We could not process your ${monthLabel} autopay. Please pay manually.`,
            url: '/portal',
          });
        } catch { /* non-critical */ }
      }
    }

    return jsonOk({ success: true, eligible: eligible.length, charged, failed });
  } catch (err) {
    console.error('autopay cron error:', err);
    return serverError();
  }
};

function formatDollar(n: number): string {
  return '$' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
