import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requireUser, jsonOk, jsonError, serverError } from '../../../lib/session';
import { getStripe } from '../../../lib/stripe';

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requireUser(env, request);
  if (auth instanceof Response) return auth;
  if (auth.role !== 'tenant') return jsonError('Not a tenant account', 403);

  try {
    const row = await env.DB.prepare('SELECT stripe_customer_id FROM user WHERE id = ?')
      .bind(auth.id)
      .first<{ stripe_customer_id: string | null }>();

    if (!row?.stripe_customer_id) return jsonOk({ success: true, data: [] });

    const stripe = getStripe(env);
    const methods = await stripe.paymentMethods.list({
      customer: row.stripe_customer_id,
      type: 'us_bank_account',
    });

    const data = methods.data.map(pm => ({
      id: pm.id,
      bankName: pm.us_bank_account?.bank_name ?? 'Bank account',
      last4: pm.us_bank_account?.last4 ?? '****',
      accountType: pm.us_bank_account?.account_type ?? 'checking',
    }));

    return jsonOk({ success: true, data });
  } catch (err) {
    console.error('Stripe payment-methods error:', err);
    return serverError();
  }
};

export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requireUser(env, request);
  if (auth instanceof Response) return auth;
  if (auth.role !== 'tenant') return jsonError('Not a tenant account', 403);

  try {
    const body = (await request.json()) as { paymentMethodId?: string };
    if (!body.paymentMethodId) return jsonError('paymentMethodId is required', 400);

    const row = await env.DB.prepare('SELECT stripe_customer_id FROM user WHERE id = ?')
      .bind(auth.id)
      .first<{ stripe_customer_id: string | null }>();
    if (!row?.stripe_customer_id) return jsonError('No Stripe customer', 404);

    const stripe = getStripe(env);
    const pm = await stripe.paymentMethods.retrieve(body.paymentMethodId);
    if (pm.customer !== row.stripe_customer_id) return jsonError('Not your payment method', 403);

    await stripe.paymentMethods.detach(body.paymentMethodId);
    return jsonOk({ success: true });
  } catch (err) {
    console.error('Stripe detach error:', err);
    return serverError();
  }
};
