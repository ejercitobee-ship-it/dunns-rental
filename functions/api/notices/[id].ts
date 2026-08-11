import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../lib/session';
import { serializeNotice } from '../../lib/serializers';

/** Get a single notice. */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'tenants_view');
  if (auth instanceof Response) return auth;

  try {
    const row = await env.DB.prepare(
      `SELECT n.*, t.first_name || ' ' || t.last_name AS tenant_name,
       p.name AS property_name, u.unit_number
       FROM notices n
       LEFT JOIN tenants t ON n.tenant_id = t.id
       LEFT JOIN properties p ON n.property_id = p.id
       LEFT JOIN units u ON n.unit_id = u.id
       WHERE n.id = ?`
    ).bind(params.id as string).first();
    if (!row) return jsonError('Notice not found', 404);

    return jsonOk({
      success: true,
      data: {
        ...serializeNotice(row as Record<string, unknown>),
        tenantName: row.tenant_name ?? undefined,
        propertyName: row.property_name ?? undefined,
        unitNumber: row.unit_number ?? undefined,
      },
    });
  } catch {
    return serverError();
  }
};

/** Update a notice. */
export const onRequestPut: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'tenants_edit');
  if (auth instanceof Response) return auth;

  try {
    const id = params.id as string;
    const body = (await request.json()) as Record<string, unknown>;

    const sets: string[] = ['updated_at = unixepoch()'];
    const binds: unknown[] = [];

    if (body.type !== undefined) { sets.push('type = ?'); binds.push(body.type); }
    if (body.title !== undefined) { sets.push('title = ?'); binds.push(body.title); }
    if (body.body !== undefined) { sets.push('body = ?'); binds.push(body.body); }
    if (body.noticeDate !== undefined) { sets.push('notice_date = ?'); binds.push(body.noticeDate); }
    if (body.deliveryMethod !== undefined) { sets.push('delivery_method = ?'); binds.push(body.deliveryMethod || null); }
    if (body.deliveredAt !== undefined) { sets.push('delivered_at = ?'); binds.push(body.deliveredAt || null); }
    if (body.status !== undefined) { sets.push('status = ?'); binds.push(body.status); }
    if (body.driveFileId !== undefined) { sets.push('drive_file_id = ?'); binds.push(body.driveFileId || null); }

    binds.push(id);
    await env.DB.prepare(`UPDATE notices SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();

    const row = await env.DB.prepare(
      `SELECT n.*, t.first_name || ' ' || t.last_name AS tenant_name,
       p.name AS property_name, u.unit_number
       FROM notices n
       LEFT JOIN tenants t ON n.tenant_id = t.id
       LEFT JOIN properties p ON n.property_id = p.id
       LEFT JOIN units u ON n.unit_id = u.id
       WHERE n.id = ?`
    ).bind(id).first();
    if (!row) return jsonError('Notice not found', 404);

    return jsonOk({
      success: true,
      data: {
        ...serializeNotice(row as Record<string, unknown>),
        tenantName: row.tenant_name ?? undefined,
        propertyName: row.property_name ?? undefined,
        unitNumber: row.unit_number ?? undefined,
      },
    });
  } catch {
    return serverError();
  }
};

/** Delete a notice. */
export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'tenants_edit');
  if (auth instanceof Response) return auth;

  try {
    await env.DB.prepare('DELETE FROM notices WHERE id = ?').bind(params.id as string).run();
    return jsonOk({ success: true });
  } catch {
    return serverError();
  }
};
