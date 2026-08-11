import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../lib/session';
import { serializeNotice } from '../../lib/serializers';

/** List notices, optionally filtered by ?tenantId=, ?leaseId=, ?type=, ?status= */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requirePermission(env, request, 'tenants_view');
  if (auth instanceof Response) return auth;

  try {
    const url = new URL(request.url);
    const tenantId = url.searchParams.get('tenantId');
    const leaseId = url.searchParams.get('leaseId');
    const type = url.searchParams.get('type');
    const status = url.searchParams.get('status');

    let sql = `SELECT n.*, t.first_name || ' ' || t.last_name AS tenant_name,
               p.name AS property_name, u.unit_number
               FROM notices n
               LEFT JOIN tenants t ON n.tenant_id = t.id
               LEFT JOIN properties p ON n.property_id = p.id
               LEFT JOIN units u ON n.unit_id = u.id
               WHERE 1=1`;
    const binds: unknown[] = [];

    if (tenantId) { sql += ' AND n.tenant_id = ?'; binds.push(tenantId); }
    if (leaseId) { sql += ' AND n.lease_id = ?'; binds.push(leaseId); }
    if (type) { sql += ' AND n.type = ?'; binds.push(type); }
    if (status) { sql += ' AND n.status = ?'; binds.push(status); }

    sql += ' ORDER BY n.created_at DESC';

    const { results } = await env.DB.prepare(sql).bind(...binds).all();
    const notices = (results || []).map((r) => ({
      ...serializeNotice(r as Record<string, unknown>),
      tenantName: r.tenant_name ?? undefined,
      propertyName: r.property_name ?? undefined,
      unitNumber: r.unit_number ?? undefined,
    }));
    return jsonOk({ success: true, data: notices });
  } catch {
    return serverError();
  }
};

/** Create a new notice. */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requirePermission(env, request, 'tenants_edit');
  if (auth instanceof Response) return auth;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    if (!body.type || !body.title || !body.body || !body.noticeDate) {
      return jsonError('type, title, body, and noticeDate are required', 400);
    }

    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO notices (id, property_id, unit_id, lease_id, tenant_id, type, title, body, notice_date, delivery_method, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        id,
        body.propertyId ?? null,
        body.unitId ?? null,
        body.leaseId ?? null,
        body.tenantId ?? null,
        body.type,
        body.title,
        body.body,
        body.noticeDate,
        body.deliveryMethod ?? null,
        body.status ?? 'draft',
        auth.id,
      )
      .run();

    const row = await env.DB.prepare(
      `SELECT n.*, t.first_name || ' ' || t.last_name AS tenant_name,
       p.name AS property_name, u.unit_number
       FROM notices n
       LEFT JOIN tenants t ON n.tenant_id = t.id
       LEFT JOIN properties p ON n.property_id = p.id
       LEFT JOIN units u ON n.unit_id = u.id
       WHERE n.id = ?`
    ).bind(id).first();
    if (!row) return serverError();

    return jsonOk({
      success: true,
      data: {
        ...serializeNotice(row as Record<string, unknown>),
        tenantName: row.tenant_name ?? undefined,
        propertyName: row.property_name ?? undefined,
        unitNumber: row.unit_number ?? undefined,
      },
    }, 201);
  } catch {
    return serverError();
  }
};
