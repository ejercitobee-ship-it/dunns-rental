import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../lib/session';
import { serializeProperty } from '../../lib/serializers';

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'properties_view');
  if (auth instanceof Response) return auth;

  try {
    const row = await env.DB.prepare('SELECT * FROM properties WHERE id = ?')
      .bind(params.id as string)
      .first();
    if (!row) return jsonError('Property not found', 404);
    return jsonOk({ success: true, data: serializeProperty(row as Record<string, unknown>) });
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

    await env.DB.prepare(
      `UPDATE properties SET
        name = ?, address = ?, city = ?, state = ?, zip_code = ?, type = ?, description = ?,
        purchase_date = ?, purchase_price = ?, land_value = ?, updated_at = unixepoch()
       WHERE id = ?`
    )
      .bind(
        body.name,
        body.address,
        body.city ?? '',
        body.state ?? '',
        body.zipCode ?? '',
        body.type ?? 'house',
        body.description ?? null,
        body.purchaseDate ?? null,
        body.purchasePrice ?? null,
        body.landValue ?? null,
        id
      )
      .run();

    const row = await env.DB.prepare('SELECT * FROM properties WHERE id = ?').bind(id).first();
    if (!row) return jsonError('Property not found', 404);
    return jsonOk({ success: true, data: serializeProperty(row as Record<string, unknown>) });
  } catch {
    return serverError();
  }
};

export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'properties_delete');
  if (auth instanceof Response) return auth;

  try {
    await env.DB.prepare('DELETE FROM properties WHERE id = ?').bind(params.id as string).run();
    return jsonOk({ success: true });
  } catch {
    return serverError();
  }
};
