import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, serverError } from '../../../lib/session';

/**
 * GET /api/maintenance/:id/history — returns the status change log for a
 * maintenance request, newest first.
 */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'properties_view');
  if (auth instanceof Response) return auth;

  try {
    const id = params.id as string;
    const { results } = await env.DB.prepare(
      `SELECT id, request_id, from_status, to_status, changed_by_id, changed_by_name, notes, created_at
         FROM maintenance_status_log
        WHERE request_id = ?
        ORDER BY created_at DESC`
    )
      .bind(id)
      .all();

    const data = (results ?? []).map((r: Record<string, unknown>) => ({
      id: r.id,
      requestId: r.request_id,
      fromStatus: r.from_status ?? null,
      toStatus: r.to_status,
      changedById: r.changed_by_id ?? undefined,
      changedByName: r.changed_by_name ?? undefined,
      notes: r.notes ?? undefined,
      createdAt: r.created_at,
    }));

    return jsonOk({ success: true, data });
  } catch {
    return serverError();
  }
};
