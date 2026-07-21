import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../lib/session';
import { serializeMaintenance } from '../../lib/serializers';

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'properties_view');
  if (auth instanceof Response) return auth;

  try {
    const row = await env.DB.prepare('SELECT * FROM maintenance_requests WHERE id = ?')
      .bind(params.id as string)
      .first();
    if (!row) return jsonError('Request not found', 404);
    return jsonOk({ success: true, data: serializeMaintenance(row as Record<string, unknown>) });
  } catch {
    return serverError();
  }
};

export const onRequestPut: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'properties_edit');
  if (auth instanceof Response) return auth;

  try {
    const id = params.id as string;
    const body = (await request.json()) as Record<string, unknown>;

    // This is the content edit (the admin modal and quick status). It never
    // touches the workflow columns (assigned_handyman_id, scheduled_for,
    // paid_at, created_by): those are owned by the assign and pay endpoints and
    // the handyman portal, so a content edit here can't wipe an assignment.
    await env.DB.prepare(
      `UPDATE maintenance_requests SET
        property_id = ?, unit_id = ?, tenant_id = ?, title = ?, description = ?, category = ?,
        priority = ?, status = ?, cost = ?, vendor = ?, reported_date = ?, resolved_date = ?, notes = ?,
        updated_at = unixepoch()
       WHERE id = ?`
    )
      .bind(
        body.propertyId ?? null,
        body.unitId ?? null,
        body.tenantId ?? null,
        body.title,
        body.description ?? null,
        body.category ?? null,
        body.priority ?? 'medium',
        body.status ?? 'submitted',
        body.cost ?? 0,
        body.vendor ?? null,
        body.reportedDate ?? null,
        body.resolvedDate ?? null,
        body.notes ?? null,
        id
      )
      .run();

    const row = await env.DB.prepare('SELECT * FROM maintenance_requests WHERE id = ?').bind(id).first();
    if (!row) return jsonError('Request not found', 404);
    return jsonOk({ success: true, data: serializeMaintenance(row as Record<string, unknown>) });
  } catch {
    return serverError();
  }
};

export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'properties_delete');
  if (auth instanceof Response) return auth;

  try {
    await env.DB.prepare('DELETE FROM maintenance_requests WHERE id = ?').bind(params.id as string).run();
    return jsonOk({ success: true });
  } catch {
    return serverError();
  }
};
