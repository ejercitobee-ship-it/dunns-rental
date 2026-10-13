import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requireUser, jsonOk, jsonError, serverError } from '../../../lib/session';
import { getStripe, getOrCreateCustomer } from '../../../lib/stripe';
import { tenantIdForUser } from '../../../lib/portal';

/** GET  — return current autopay state for the signed-in tenant.
 *  POST — enable or disable autopay. */

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requireUser(env, request);
  if (auth instanceof Response) return auth;
  if (auth.role !== 'tenant') return jsonError('Not a tenant account', 403);

  const row = await env.DB.prepare(
    'SELECT autopay_enabled, autopay_payment_method_id, autopay_method_type FROM user WHERE id = ?'
  ).bind(auth.id).first<{ autopay_enabled: number; autopay_payment_method_id: string | null; autopay_method_type: string | null }>();

  return jsonOk({
    enabled: row?.autopay_enabled === 1,
    paymentMethodId: row?.autopay_payment_method_id ?? null,
    methodType: row?.autopay_method_type ?? 'us_bank_account',
  });
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requireUser(env, request);
  if (auth instanceof Response) return auth;
  if (auth.role !== 'tenant') return jsonError('Not a tenant account', 403);

  try {
    const body = (await request.json()) as {
      enabled: boolean;
      paymentMethodId?: string;
    };

    if (body.enabled) {
      if (!body.paymentMethodId) return jsonError('paymentMethodId is required to enable autopay', 400);

      const tenantId = await tenantIdForUser(env, auth.id);
      if (!tenantId) return jsonError('No tenant record linked', 404);
      const tenant = await env.DB.prepare('SELECT email, first_name, last_name FROM tenants WHERE id = ?')
        .bind(tenantId).first<{ email: string; first_name: string; last_name: string }>();
      const name = [tenant?.first_name, tenant?.last_name].filter(Boolean).join(' ') || undefined;
      const customerId = await getOrCreateCustomer(env, auth.id, tenant?.email || auth.email, name);

      const stripe = getStripe(env);
      const pm = await stripe.paymentMethods.retrieve(body.paymentMethodId);
      if (pm.customer !== customerId) return jsonError('Payment method does not belong to you', 403);

      const methodType = pm.type === 'card' ? 'card' : 'us_bank_account';

      const ip = request.headers.get('CF-Connecting-IP') || '';
      const ua = request.headers.get('User-Agent') || '';
      await env.DB.prepare(
        'UPDATE user SET autopay_enabled = 1, autopay_payment_method_id = ?, autopay_method_type = ?, autopay_ip = ?, autopay_user_agent = ? WHERE id = ?'
      ).bind(body.paymentMethodId, methodType, ip, ua, auth.id).run();
    } else {
      await env.DB.prepare(
        'UPDATE user SET autopay_enabled = 0, autopay_payment_method_id = NULL, autopay_method_type = NULL WHERE id = ?'
      ).bind(auth.id).run();
    }

    return jsonOk({ success: true, enabled: !!body.enabled });
  } catch (err) {
    console.error('Stripe autopay error:', err);
    return serverError();
  }
};
