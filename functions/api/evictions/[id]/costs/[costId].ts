import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../../../lib/session';

export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'evictions_manage');
  if (auth instanceof Response) return auth;

  try {
    const costId = params.costId as string;
    const existing = await env.DB.prepare('SELECT id FROM eviction_costs WHERE id = ?').bind(costId).first();
    if (!existing) return jsonError('Cost entry not found', 404);

    await env.DB.batch([
      env.DB.prepare('DELETE FROM eviction_costs WHERE id = ?').bind(costId),
      env.DB.prepare('DELETE FROM expenses WHERE id = ?').bind(`evict-${costId}`),
    ]);
    return jsonOk({ success: true });
  } catch {
    return serverError();
  }
};
