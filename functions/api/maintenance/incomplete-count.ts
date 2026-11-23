import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, serverError } from '../../lib/session';

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requirePermission(env, request, 'properties_view');
  if (auth instanceof Response) return auth;

  try {
    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS cnt FROM maintenance_requests
       WHERE status NOT IN ('paid', 'invoice_approved', 'cancelled', 'resolved_no_cost')`
    ).first<{ cnt: number }>();
    return jsonOk({ count: row?.cnt ?? 0 });
  } catch {
    return serverError();
  }
};
