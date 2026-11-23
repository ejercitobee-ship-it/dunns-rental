import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../../lib/session';
import { serializeEvictionCost } from '../../../lib/serializers';

function evictionExpenseId(costId: string): string {
  return `evict-${costId}`;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'evictions_view');
  if (auth instanceof Response) return auth;

  try {
    const evictionId = params.id as string;
    const { results } = await env.DB.prepare(
      'SELECT * FROM eviction_costs WHERE eviction_id = ? ORDER BY cost_date DESC'
    ).bind(evictionId).all();

    return jsonOk({ success: true, data: (results || []).map(r => serializeEvictionCost(r as Record<string, unknown>)) });
  } catch {
    return serverError();
  }
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'evictions_manage');
  if (auth instanceof Response) return auth;

  try {
    const evictionId = params.id as string;
    const eviction = await env.DB.prepare(
      'SELECT id, property_id, unit_id, tenant_id FROM evictions WHERE id = ?'
    ).bind(evictionId).first() as Record<string, unknown> | null;
    if (!eviction) return jsonError('Eviction not found', 404);

    const body = (await request.json()) as Record<string, unknown>;
    if (!body.description || body.amount == null || !body.costDate) {
      return jsonError('description, amount, and costDate are required', 400);
    }

    const id = crypto.randomUUID();
    const amount = Number(body.amount);
    const costDate = body.costDate as string;
    const description = body.description as string;
    const expenseId = evictionExpenseId(id);

    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO eviction_costs (id, eviction_id, description, amount, cost_date, category, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).bind(id, evictionId, description, amount, costDate, body.category ?? 'lawyer_fee', body.notes ?? null),
      env.DB.prepare(
        `INSERT INTO expenses (id, property_id, unit_id, category, amount, date, description, vendor, is_recurring, user_id)
         VALUES (?, ?, ?, 'legal', ?, ?, ?, ?, 0, ?)`
      ).bind(
        expenseId,
        eviction.property_id ?? null,
        eviction.unit_id ?? null,
        amount,
        costDate,
        `Eviction: ${description}`,
        null,
        auth.id,
      ),
    ]);

    return jsonOk({ success: true, data: { id } }, 201);
  } catch {
    return serverError();
  }
};
