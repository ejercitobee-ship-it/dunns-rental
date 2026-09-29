import Stripe from 'stripe';
import type { Env } from './session';

let _stripe: Stripe | null = null;

export function getStripe(env: Env): Stripe {
  if (!env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY is not configured');
  if (!_stripe) {
    _stripe = new Stripe(env.STRIPE_SECRET_KEY, {
      apiVersion: '2026-08-26.dahlia',
      httpClient: Stripe.createFetchHttpClient(),
    });
  }
  return _stripe;
}

export async function getOrCreateCustomer(
  env: Env,
  userId: string,
  email: string,
  name?: string,
): Promise<string> {
  const row = await env.DB.prepare('SELECT stripe_customer_id FROM user WHERE id = ?')
    .bind(userId)
    .first<{ stripe_customer_id: string | null }>();

  if (row?.stripe_customer_id) return row.stripe_customer_id;

  const stripe = getStripe(env);
  const customer = await stripe.customers.create({
    email,
    name: name || undefined,
    metadata: { userId },
  });

  await env.DB.prepare('UPDATE user SET stripe_customer_id = ? WHERE id = ?')
    .bind(customer.id, userId)
    .run();

  return customer.id;
}
