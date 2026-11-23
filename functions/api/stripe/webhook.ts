import type { PagesFunction } from '@cloudflare/workers-types';
import type { Env } from '../../lib/session';
import { getStripe } from '../../lib/stripe';
import { syncRentSheet } from '../../lib/sheets';
import { getManagementUserIds, notifyMultiple } from '../../lib/notify';
import { generateReceipt } from '../../lib/receipts';
import { linkPaymentToInstallment } from '../../lib/payment-plan-link';

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;

  if (!env.STRIPE_WEBHOOK_SECRET) {
    return new Response('Webhook secret not configured', { status: 500 });
  }

  const body = await request.text();
  const sig = request.headers.get('stripe-signature');
  if (!sig) return new Response('Missing signature', { status: 400 });

  const stripe = getStripe(env);
  let event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, sig, env.STRIPE_WEBHOOK_SECRET);
  } catch {
    return new Response('Invalid signature', { status: 400 });
  }

  // Idempotency, race-safe. Claim the event id FIRST: INSERT OR IGNORE against
  // the event_id primary key means only the first delivery of a given event
  // creates a row. Concurrent Stripe retries see 0 changes and return early,
  // before any side effect runs, which closes the duplicate-processing window
  // that a separate read-then-write check left open.
  const claim = await env.DB.prepare(
    'INSERT OR IGNORE INTO processed_stripe_events (event_id, created_at) VALUES (?, ?)'
  ).bind(event.id, new Date().toISOString()).run();
  if (!claim.meta.changes) return new Response('ok', { status: 200 });

  if (event.type === 'payment_intent.succeeded') {
    const pi = event.data.object;
    const piId = pi.id;

    const row = await env.DB.prepare(
      'SELECT id, lease_id FROM rent_payments WHERE stripe_payment_intent_id = ?'
    ).bind(piId).first<{ id: string; lease_id: string }>();

    if (row) {
      await env.DB.prepare(
        "UPDATE rent_payments SET status = 'paid', paid_date = ? WHERE id = ?"
      ).bind(new Date().toISOString().slice(0, 10), row.id).run();

      try { syncRentSheet({ env, waitUntil: context.waitUntil.bind(context) }); } catch { /* sheet sync is best-effort */ }

      // Auto-link to payment plan installment.
      const rpForLink = await env.DB.prepare(
        'SELECT month, year, paid_date FROM rent_payments WHERE id = ?'
      ).bind(row.id).first<{ month: number; year: number; paid_date: string | null }>();
      if (rpForLink?.month && rpForLink?.year) {
        context.waitUntil(
          linkPaymentToInstallment(
            env, row.lease_id, rpForLink.month, rpForLink.year,
            rpForLink.paid_date || new Date().toISOString().slice(0, 10)
          ).catch(err => console.error('stripe payment-plan link error:', err))
        );
      }

      const isAutopay = pi.metadata?.autopay === 'true';
      context.waitUntil(
        getManagementUserIds(env).then(userIds =>
          notifyMultiple(env, userIds.map(uid => ({
            userId: uid,
            type: 'payment',
            category: 'payment_autopay',
            title: isAutopay ? 'Autopay rent payment received' : 'Online rent payment received',
            entityType: 'rent_payment',
            entityId: row.id,
            route: '/rent',
          })))
        ).catch(() => {})
      );

      context.waitUntil(
        generateReceipt(env, row.id, pi.metadata?.userId || 'system').catch((err) => {
          console.error('Webhook receipt generation failed:', err);
        })
      );
    }
  }

  if (event.type === 'payment_intent.payment_failed') {
    const pi = event.data.object;
    await env.DB.prepare(
      "UPDATE rent_payments SET status = 'failed' WHERE stripe_payment_intent_id = ?"
    ).bind(pi.id).run();
  }

  if (event.type === 'charge.dispute.created') {
    const charge = event.data.object;
    const piId = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id;
    if (piId) {
      await env.DB.prepare(
        "UPDATE rent_payments SET status = 'disputed' WHERE stripe_payment_intent_id = ?"
      ).bind(piId).run();

      context.waitUntil(
        getManagementUserIds(env).then(userIds =>
          notifyMultiple(env, userIds.map(uid => ({
            userId: uid,
            type: 'payment',
            category: 'payment_dispute',
            title: 'Payment disputed: a tenant filed a chargeback',
            entityType: 'rent_payment',
            entityId: piId,
            route: '/rent',
          })))
        ).catch(() => {})
      );
    }
  }

  if (event.type === 'charge.refunded') {
    const charge = event.data.object;
    const piId = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id;
    if (piId) {
      await env.DB.prepare(
        "UPDATE rent_payments SET status = 'refunded' WHERE stripe_payment_intent_id = ?"
      ).bind(piId).run();

      context.waitUntil(
        getManagementUserIds(env).then(userIds =>
          notifyMultiple(env, userIds.map(uid => ({
            userId: uid,
            type: 'payment',
            category: 'payment_refund',
            title: 'A Stripe payment has been refunded',
            entityType: 'rent_payment',
            entityId: piId,
            route: '/rent',
          })))
        ).catch(() => {})
      );
    }
  }

  // The event was already claimed at the top of the handler, so there is no
  // second insert to do here.
  return new Response('ok', { status: 200 });
};
