import type { PagesFunction } from '@cloudflare/workers-types';
import type { Env } from '../../lib/session';
import { getStripe } from '../../lib/stripe';
import { syncRentSheet } from '../../lib/sheets';
import { getManagementUserIds, notifyMultiple } from '../../lib/notify';
import { generateReceipt } from '../../lib/receipts';

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

  const already = await env.DB.prepare(
    'SELECT 1 FROM processed_stripe_events WHERE event_id = ?'
  ).bind(event.id).first();
  if (already) return new Response('ok', { status: 200 });

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

      try { syncRentSheet({ env, waitUntil: context.waitUntil.bind(context) }); } catch {}

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

  await env.DB.prepare(
    'INSERT INTO processed_stripe_events (event_id, created_at) VALUES (?, ?)'
  ).bind(event.id, new Date().toISOString()).run();

  return new Response('ok', { status: 200 });
};
