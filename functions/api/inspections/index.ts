import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../lib/session';
import { serializeInspection } from '../../lib/serializers';

/** List inspections, optionally filtered by ?unitId=, ?leaseId=, ?tenantId=, ?type= */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requirePermission(env, request, 'properties_view');
  if (auth instanceof Response) return auth;

  try {
    const url = new URL(request.url);
    const unitId = url.searchParams.get('unitId');
    const leaseId = url.searchParams.get('leaseId');
    const tenantId = url.searchParams.get('tenantId');
    const type = url.searchParams.get('type');

    let sql = `SELECT i.*, t.first_name || ' ' || t.last_name AS tenant_name,
               p.name AS property_name, u.unit_number
               FROM inspections i
               LEFT JOIN tenants t ON i.tenant_id = t.id
               LEFT JOIN properties p ON i.property_id = p.id
               LEFT JOIN units u ON i.unit_id = u.id
               WHERE 1=1`;
    const binds: unknown[] = [];

    if (unitId) { sql += ' AND i.unit_id = ?'; binds.push(unitId); }
    if (leaseId) { sql += ' AND i.lease_id = ?'; binds.push(leaseId); }
    if (tenantId) { sql += ' AND i.tenant_id = ?'; binds.push(tenantId); }
    if (type) { sql += ' AND i.type = ?'; binds.push(type); }

    sql += ' ORDER BY i.inspection_date DESC, i.created_at DESC';

    const { results } = await env.DB.prepare(sql).bind(...binds).all();
    const inspections = (results || []).map((r) => ({
      ...serializeInspection(r as Record<string, unknown>),
      tenantName: r.tenant_name ?? undefined,
      propertyName: r.property_name ?? undefined,
      unitNumber: r.unit_number ?? undefined,
    }));
    return jsonOk({ success: true, data: inspections });
  } catch {
    return serverError();
  }
};

/** Create a new inspection with optional items. */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requirePermission(env, request, 'properties_edit');
  if (auth instanceof Response) return auth;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    if (!body.inspectionDate || !body.type) {
      return jsonError('inspectionDate and type are required', 400);
    }

    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO inspections (id, property_id, unit_id, lease_id, tenant_id, type, inspection_date, inspector_name, status, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        id,
        body.propertyId ?? null,
        body.unitId ?? null,
        body.leaseId ?? null,
        body.tenantId ?? null,
        body.type,
        body.inspectionDate,
        body.inspectorName ?? null,
        body.status ?? 'draft',
        body.notes ?? null,
      )
      .run();

    // Insert items if provided
    const items = body.items as Array<{ room: string; item: string; condition: string; notes?: string }> | undefined;
    if (items && Array.isArray(items)) {
      for (const it of items) {
        if (!it.room || !it.item) continue;
        await env.DB.prepare(
          'INSERT INTO inspection_items (id, inspection_id, room, item, condition, notes) VALUES (?, ?, ?, ?, ?, ?)'
        )
          .bind(crypto.randomUUID(), id, it.room, it.item, it.condition || 'good', it.notes ?? null)
          .run();
      }
    }

    const row = await env.DB.prepare(
      `SELECT i.*, t.first_name || ' ' || t.last_name AS tenant_name,
       p.name AS property_name, u.unit_number
       FROM inspections i
       LEFT JOIN tenants t ON i.tenant_id = t.id
       LEFT JOIN properties p ON i.property_id = p.id
       LEFT JOIN units u ON i.unit_id = u.id
       WHERE i.id = ?`
    ).bind(id).first();
    if (!row) return serverError();

    return jsonOk({
      success: true,
      data: {
        ...serializeInspection(row as Record<string, unknown>),
        tenantName: row.tenant_name ?? undefined,
        propertyName: row.property_name ?? undefined,
        unitNumber: row.unit_number ?? undefined,
      },
    }, 201);
  } catch {
    return serverError();
  }
};
