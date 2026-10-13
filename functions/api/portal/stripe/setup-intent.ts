import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requireUser, jsonOk, jsonError } from '../../../lib/session';
import { tenantIdForUser } from '../../../lib/portal';
import { getStripe, getOrCreateCustomer } from '../../../lib/stripe';

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requireUser(env, request);
  if (auth instanceof Response) return auth;
  if (auth.role !== 'tenant') return jsonError('Not a tenant account', 403);

  const tenantId = await tenantIdForUser(env, auth.id);
  if (!tenantId) return jsonError('No tenant record linked', 404);

  try {
    const body = (await request.json().catch(() => ({}))) as { type?: string };
    const methodType = body.type === 'card' ? 'card' : 'us_bank_account';

    const tenant = await env.DB.prepare('SELECT first_name, last_name, email FROM tenants WHERE id = ?')
      .bind(tenantId)
      .first<{ first_name: string; last_name: string; email: string }>();

    const name = [tenant?.first_name, tenant?.last_name].filter(Boolean).join(' ') || undefined;
    const email = tenant?.email || auth.email;
    const customerId = await getOrCreateCustomer(env, auth.id, email, name);
    const stripe = getStripe(env);

    const setupParams: Parameters<typeof stripe.setupIntents.create>[0] = {
      customer: customerId,
      payment_method_types: [methodType],
    };

    if (methodType === 'us_bank_account') {
      setupParams.payment_method_options = {
        us_bank_account: {
          financial_connections: { permissions: ['payment_method'] },
        },
      };
    }

    const setupIntent = await stripe.setupIntents.create(setupParams);

    return jsonOk({
      success: true,
      data: { clientSecret: setupIntent.client_secret, type: methodType },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('Stripe setup-intent error:', msg);
    return jsonError(msg, 500);
  }
};
