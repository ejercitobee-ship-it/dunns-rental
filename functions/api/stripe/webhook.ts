import type { PagesFunction } from '@cloudflare/workers-types';
import type { Env } from '../../lib/session';
import { getStripe } from '../../lib/stripe';
import { syncRentSheet } from '../../lib/sheets';

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
    }
  }

  if (event.type === 'payment_intent.payment_failed') {
    const pi = event.data.object;
    const piId = pi.id;

    await env.DB.prepare(
      "UPDATE rent_payments SET status = 'failed' WHERE stripe_payment_intent_id = ?"
    ).bind(piId).run();
  }

  return new Response('ok', { status: 200 });
};
