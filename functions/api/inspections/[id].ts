import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../lib/session';
import { serializeInspection, serializeInspectionItem } from '../../lib/serializers';

/** Get a single inspection with all its items. */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'properties_view');
  if (auth instanceof Response) return auth;

  try {
    const id = params.id as string;
    const row = await env.DB.prepare(
      `SELECT i.*, t.first_name || ' ' || t.last_name AS tenant_name,
       p.name AS property_name, u.unit_number
       FROM inspections i
       LEFT JOIN tenants t ON i.tenant_id = t.id
       LEFT JOIN properties p ON i.property_id = p.id
       LEFT JOIN units u ON i.unit_id = u.id
       WHERE i.id = ?`
    ).bind(id).first();
    if (!row) return jsonError('Inspection not found', 404);

    const { results: itemRows } = await env.DB.prepare(
      'SELECT * FROM inspection_items WHERE inspection_id = ? ORDER BY room ASC, item ASC'
    ).bind(id).all();

    return jsonOk({
      success: true,
      data: {
        ...serializeInspection(row as Record<string, unknown>),
        tenantName: row.tenant_name ?? undefined,
        propertyName: row.property_name ?? undefined,
        unitNumber: row.unit_number ?? undefined,
        items: (itemRows || []).map((r) => serializeInspectionItem(r as Record<string, unknown>)),
      },
    });
  } catch {
    return serverError();
  }
};

/** Update an inspection and replace its items. */
export const onRequestPut: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'properties_edit');
  if (auth instanceof Response) return auth;

  try {
    const id = params.id as string;
    const body = (await request.json()) as Record<string, unknown>;

    // Build dynamic update
    const sets: string[] = ['updated_at = unixepoch()'];
    const binds: unknown[] = [];

    if (body.type !== undefined) { sets.push('type = ?'); binds.push(body.type); }
    if (body.inspectionDate !== undefined) { sets.push('inspection_date = ?'); binds.push(body.inspectionDate); }
    if (body.inspectorName !== undefined) { sets.push('inspector_name = ?'); binds.push(body.inspectorName || null); }
    if (body.status !== undefined) { sets.push('status = ?'); binds.push(body.status); }
    if (body.notes !== undefined) { sets.push('notes = ?'); binds.push(body.notes || null); }
    if (body.driveFileId !== undefined) { sets.push('drive_file_id = ?'); binds.push(body.driveFileId || null); }

    binds.push(id);
    await env.DB.prepare(`UPDATE inspections SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();

    // Replace items if provided
    const items = body.items as Array<{ room: string; item: string; condition: string; notes?: string }> | undefined;
    if (items && Array.isArray(items)) {
      await env.DB.prepare('DELETE FROM inspection_items WHERE inspection_id = ?').bind(id).run();
      for (const it of items) {
        if (!it.room || !it.item) continue;
        await env.DB.prepare(
          'INSERT INTO inspection_items (id, inspection_id, room, item, condition, notes) VALUES (?, ?, ?, ?, ?, ?)'
        )
          .bind(crypto.randomUUID(), id, it.room, it.item, it.condition || 'good', it.notes ?? null)
          .run();
      }
    }

    // Return updated record
    const row = await env.DB.prepare(
      `SELECT i.*, t.first_name || ' ' || t.last_name AS tenant_name,
       p.name AS property_name, u.unit_number
       FROM inspections i
       LEFT JOIN tenants t ON i.tenant_id = t.id
       LEFT JOIN properties p ON i.property_id = p.id
       LEFT JOIN units u ON i.unit_id = u.id
       WHERE i.id = ?`
    ).bind(id).first();
    if (!row) return jsonError('Inspection not found', 404);

    const { results: itemRows } = await env.DB.prepare(
      'SELECT * FROM inspection_items WHERE inspection_id = ? ORDER BY room ASC, item ASC'
    ).bind(id).all();

    return jsonOk({
      success: true,
      data: {
        ...serializeInspection(row as Record<string, unknown>),
        tenantName: row.tenant_name ?? undefined,
        propertyName: row.property_name ?? undefined,
        unitNumber: row.unit_number ?? undefined,
        items: (itemRows || []).map((r) => serializeInspectionItem(r as Record<string, unknown>)),
      },
    });
  } catch {
    return serverError();
  }
};

/** Delete an inspection and its items (cascade). */
export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'properties_edit');
  if (auth instanceof Response) return auth;

  try {
    await env.DB.prepare('DELETE FROM inspections WHERE id = ?').bind(params.id as string).run();
    return jsonOk({ success: true });
  } catch {
    return serverError();
  }
};
