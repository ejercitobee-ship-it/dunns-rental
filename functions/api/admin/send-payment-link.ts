import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError } from '../../lib/session';
import { getStripe } from '../../lib/stripe';
import { cardFee } from '../../lib/stripe-fee';
import { sendEmail, paymentLinkEmail } from '../../lib/email';
import { logActivityStmt } from '../../lib/activity';
import { SITE_URL } from '../../lib/site';

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requirePermission(env, request, 'rents_manage');
  if (auth instanceof Response) return auth;

  try {
    const body = await request.json<{
      tenantId: string;
      leaseId: string;
      amount: number;
      month: number;
      year: number;
      note?: string;
      email?: string;
    }>();

    if (!body.tenantId || !body.leaseId || !body.amount || !body.month || !body.year) {
      return jsonError('Missing required fields', 400);
    }
    if (body.amount <= 0) return jsonError('Amount must be positive', 400);

    const tenant = await env.DB.prepare(
      `SELECT id, first_name, last_name, email, phone FROM tenants WHERE id = ?`
    ).bind(body.tenantId).first<{
      id: string; first_name: string; last_name: string; email: string | null; phone: string | null;
    }>();
    if (!tenant) return jsonError('Tenant not found', 404);

    const recipientEmail = body.email?.trim() || tenant.email;
    if (!recipientEmail) return jsonError('No email address provided', 400);

    const lease = await env.DB.prepare('SELECT id, monthly_rent FROM leases WHERE id = ?')
      .bind(body.leaseId).first<{ id: string; monthly_rent: number }>();
    if (!lease) return jsonError('Lease not found', 404);

    const fee = cardFee(body.amount);
    const totalCents = Math.round((body.amount + fee) * 100);
    const rentCents = Math.round(body.amount * 100);
    const feeCents = totalCents - rentCents;

    const stripe = getStripe(env);

    const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const monthLabel = `${monthNames[body.month - 1]} ${body.year}`;

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card', 'us_bank_account'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: { name: `Rent Payment: ${monthLabel}` },
            unit_amount: rentCents,
          },
          quantity: 1,
        },
        {
          price_data: {
            currency: 'usd',
            product_data: { name: 'Processing Fee' },
            unit_amount: feeCents,
          },
          quantity: 1,
        },
      ],
      payment_intent_data: {
        metadata: {
          leaseId: body.leaseId,
          tenantId: body.tenantId,
          month: String(body.month),
          year: String(body.year),
          rentAmount: String(body.amount),
          processingFee: String(fee),
          source: 'payment_link',
        },
      },
      metadata: {
        leaseId: body.leaseId,
        tenantId: body.tenantId,
        source: 'payment_link',
      },
      success_url: `${SITE_URL}/portal/payments?paid=true`,
      cancel_url: `${SITE_URL}/portal/payments`,
      expires_at: Math.floor(Date.now() / 1000) + 24 * 3600,
    });

    const paymentIntentId = typeof session.payment_intent === 'string'
      ? session.payment_intent
      : session.payment_intent?.id ?? null;

    if (paymentIntentId) {
      const paymentId = crypto.randomUUID();
      await env.DB.prepare(
        `INSERT INTO rent_payments (id, lease_id, paid_by_tenant_id, amount, paid_date, status, month, year,
          payment_method, uploaded_by, uploaded_at, type, stripe_payment_intent_id, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        paymentId,
        body.leaseId,
        body.tenantId,
        body.amount,
        null,
        'processing',
        body.month,
        body.year,
        'card',
        auth.id,
        new Date().toISOString(),
        'payment',
        paymentIntentId,
        body.note ? `Payment link: ${body.note}` : 'Payment link sent',
      ).run();
    }

    const tenantName = [tenant.first_name, tenant.last_name].filter(Boolean).join(' ') || 'Tenant';
    const emailContent = paymentLinkEmail({
      name: tenantName,
      amount: body.amount,
      fee,
      monthLabel,
      paymentUrl: session.url!,
      note: body.note,
    });

    const sent = await sendEmail(env, {
      to: recipientEmail,
      subject: emailContent.subject,
      html: emailContent.html,
      text: emailContent.text,
    });

    const activityStmt = logActivityStmt(
      env.DB,
      { id: auth.id },
      {
        module: 'finances',
        action: 'payment_link_sent',
        tenantId: body.tenantId,
        targetName: tenantName,
        description: `Sent payment link for ${monthLabel}: $${body.amount.toFixed(2)}`,
      },
    );
    if (activityStmt) await activityStmt.run();

    return jsonOk({
      sent,
      url: session.url,
      email: recipientEmail,
      amount: body.amount,
      fee,
      total: body.amount + fee,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('send-payment-link error:', msg, err);
    return jsonError(msg || 'Internal server error', 500);
  }
};
