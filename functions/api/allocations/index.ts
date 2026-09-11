import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, serverError } from '../../lib/session';
import { serializeAllocation } from '../../lib/serializers';

/**
 * GET /api/allocations — list all payment allocations.
 * Used by the Rents page to load the full allocation set for settlement math.
 */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requirePermission(env, request, 'rents_view');
  if (auth instanceof Response) return auth;

  try {
    const { results } = await env.DB.prepare(
      'SELECT * FROM payment_allocations ORDER BY year, month'
    ).all();
    return jsonOk({ success: true, data: (results || []).map(serializeAllocation) });
  } catch {
    return serverError();
  }
};
