import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../lib/session';
import { serializeProperty } from '../../lib/serializers';
import { logActivityStmt } from '../../lib/activity';

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
    const before = await env.DB.prepare('SELECT * FROM properties WHERE id = ?').bind(id)
      .first<Record<string, unknown>>();
    if (!before) return jsonError('Property not found', 404);

    const body = (await request.json()) as Record<string, unknown>;

    await env.DB.batch([
      env.DB.prepare(
        `UPDATE properties SET
          name = ?, address = ?, city = ?, state = ?, zip_code = ?, type = ?, description = ?,
          purchase_date = ?, purchase_price = ?, land_value = ?, updated_at = unixepoch()
         WHERE id = ?`
      ).bind(
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
      ),
      logActivityStmt(env.DB, auth, {
        module: 'properties',
        action: 'Updated a property',
        targetType: 'properties',
        targetId: id,
        targetName: String(body.name || before.name),
        propertyId: id,
        previousValues: { name: before.name, address: before.address, city: before.city, state: before.state, type: before.type, purchasePrice: before.purchase_price },
        newValues: { name: body.name, address: body.address, city: body.city, state: body.state, type: body.type, purchasePrice: body.purchasePrice },
      }),
    ]);

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
    const id = params.id as string;
    const before = await env.DB.prepare('SELECT name FROM properties WHERE id = ?').bind(id).first<{ name: string }>();
    await env.DB.batch([
      env.DB.prepare('DELETE FROM properties WHERE id = ?').bind(id),
      logActivityStmt(env.DB, auth, {
        module: 'properties',
        action: 'Deleted a property',
        targetType: 'properties',
        targetId: id,
        targetName: before?.name || undefined,
        propertyId: id,
      }),
    ]);
    return jsonOk({ success: true });
  } catch {
    return serverError();
  }
};
