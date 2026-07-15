import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../lib/session';
import { serializeMaintenance } from '../../lib/serializers';

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requirePermission(env, request, 'properties_view');
  if (auth instanceof Response) return auth;

  try {
    const { results } = await env.DB.prepare(
      'SELECT * FROM maintenance_requests ORDER BY created_at DESC'
    ).all();
    return jsonOk({ success: true, data: (results || []).map(serializeMaintenance) });
  } catch {
    return serverError();
  }
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requirePermission(env, request, 'properties_edit');
  if (auth instanceof Response) return auth;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    if (!body.title) {
      return jsonError('A title is required', 400);
    }

    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO maintenance_requests
        (id, property_id, unit_id, tenant_id, title, description, category, priority, status, cost, vendor, reported_date, resolved_date, notes, user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        id,
        body.propertyId ?? null,
        body.unitId ?? null,
        body.tenantId ?? null,
        body.title,
        body.description ?? null,
        body.category ?? null,
        body.priority ?? 'medium',
        body.status ?? 'open',
        body.cost ?? 0,
        body.vendor ?? null,
        body.reportedDate ?? new Date().toISOString().split('T')[0],
        body.resolvedDate ?? null,
        body.notes ?? null,
        auth.id
      )
      .run();

    const row = await env.DB.prepare('SELECT * FROM maintenance_requests WHERE id = ?').bind(id).first();
    return jsonOk({ success: true, data: serializeMaintenance(row as Record<string, unknown>) }, 201);
  } catch {
    return serverError();
  }
};
