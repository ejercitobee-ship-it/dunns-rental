import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requireUser, jsonOk, jsonError, serverError } from '../../../lib/session';
import { tenantIdForUser } from '../../../lib/portal';
import { getStripe, getOrCreateCustomer } from '../../../lib/stripe';

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requireUser(env, request);
  if (auth instanceof Response) return auth;
  if (auth.role !== 'tenant') return jsonError('Not a tenant account', 403);

  try {
    const body = (await request.json()) as {
      paymentMethodId: string;
      amount: number;
      month: number;
      year: number;
      leaseId: string;
    };

    if (!body.paymentMethodId) return jsonError('paymentMethodId is required', 400);
    if (!Number.isFinite(body.amount) || body.amount <= 0) return jsonError('amount must be positive', 400);
    if (!body.month || !body.year) return jsonError('month and year are required', 400);
    if (!body.leaseId) return jsonError('leaseId is required', 400);

    const tenantId = await tenantIdForUser(env, auth.id);
    if (!tenantId) return jsonError('No tenant record linked', 404);

    const lease = await env.DB.prepare(
      `SELECT l.id FROM leases l
         JOIN lease_tenants lt ON lt.lease_id = l.id
        WHERE lt.tenant_id = ? AND l.id = ? AND l.status != 'ended'`
    ).bind(tenantId, body.leaseId).first();
    if (!lease) return jsonError('Lease not found or not active', 404);

    const existing = await env.DB.prepare(
      `SELECT id FROM rent_payments
       WHERE lease_id = ? AND month = ? AND year = ? AND stripe_payment_intent_id IS NOT NULL
         AND status != 'failed'`
    ).bind(body.leaseId, body.month, body.year).first();
    if (existing) return jsonError('A Stripe payment for this month is already in progress', 409);

    const tenant = await env.DB.prepare('SELECT email, first_name, last_name FROM tenants WHERE id = ?')
      .bind(tenantId)
      .first<{ email: string; first_name: string; last_name: string }>();
    const name = [tenant?.first_name, tenant?.last_name].filter(Boolean).join(' ') || undefined;
    const customerId = await getOrCreateCustomer(env, auth.id, tenant?.email || auth.email, name);

    const stripe = getStripe(env);
    const amountCents = Math.round(body.amount * 100);

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: 'usd',
      customer: customerId,
      payment_method: body.paymentMethodId,
      payment_method_types: ['us_bank_account'],
      confirm: true,
      mandate_data: {
        customer_acceptance: {
          type: 'online',
          online: {
            ip_address: request.headers.get('CF-Connecting-IP') || '0.0.0.0',
            user_agent: request.headers.get('User-Agent') || '',
          },
        },
      },
      metadata: {
        leaseId: body.leaseId,
        tenantId,
        month: String(body.month),
        year: String(body.year),
        userId: auth.id,
      },
    });

    const paymentId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO rent_payments (id, lease_id, paid_by_tenant_id, amount, paid_date, status, month, year,
        payment_method, uploaded_by, uploaded_at, type, stripe_payment_intent_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      paymentId,
      body.leaseId,
      tenantId,
      body.amount,
      new Date().toISOString().slice(0, 10),
      'processing',
      body.month,
      body.year,
      'bank_transfer',
      auth.id,
      new Date().toISOString(),
      'payment',
      paymentIntent.id,
    ).run();

    return jsonOk({
      success: true,
      data: {
        paymentIntentId: paymentIntent.id,
        clientSecret: paymentIntent.client_secret,
        status: paymentIntent.status,
      },
    });
  } catch (err) {
    console.error('Stripe pay-rent error:', err);
    return serverError();
  }
};
