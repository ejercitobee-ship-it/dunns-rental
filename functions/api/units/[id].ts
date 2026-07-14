import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../lib/session';
import { serializeUnit } from '../../lib/serializers';

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'units_view');
  if (auth instanceof Response) return auth;

  try {
    const row = await env.DB.prepare('SELECT * FROM units WHERE id = ?')
      .bind(params.id as string)
      .first();
    if (!row) return jsonError('Unit not found', 404);
    return jsonOk({ success: true, data: serializeUnit(row as Record<string, unknown>) });
  } catch {
    return serverError();
  }
};

export const onRequestPut: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'units_edit');
  if (auth instanceof Response) return auth;

  try {
    const id = params.id as string;
    const body = (await request.json()) as Record<string, unknown>;

    await env.DB.prepare(
      `UPDATE units SET
        property_id = ?, unit_number = ?, bedrooms = ?, bathrooms = ?, square_feet = ?, monthly_rent = ?, description = ?, status = ?,
        updated_at = unixepoch()
       WHERE id = ?`
    )
      .bind(
        body.propertyId,
        body.unitNumber ?? '',
        body.bedrooms ?? 1,
        body.bathrooms ?? 1,
        body.squareFeet ?? 0,
        body.monthlyRent ?? 0,
        body.description ?? null,
        body.status ?? 'vacant',
        id
      )
      .run();

    const row = await env.DB.prepare('SELECT * FROM units WHERE id = ?').bind(id).first();
    if (!row) return jsonError('Unit not found', 404);
    return jsonOk({ success: true, data: serializeUnit(row as Record<string, unknown>) });
  } catch {
    return serverError();
  }
};

export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'units_delete');
  if (auth instanceof Response) return auth;

  try {
    await env.DB.prepare('DELETE FROM units WHERE id = ?').bind(params.id as string).run();
    return jsonOk({ success: true });
  } catch {
    return serverError();
  }
};
