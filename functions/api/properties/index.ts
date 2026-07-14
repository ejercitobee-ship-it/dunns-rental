import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, serverError } from '../../lib/session';
import { serializeProperty } from '../../lib/serializers';

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requirePermission(env, request, 'properties_view');
  if (auth instanceof Response) return auth;

  try {
    const { results } = await env.DB.prepare(
      'SELECT * FROM properties ORDER BY created_at DESC'
    ).all();
    return jsonOk({ success: true, data: (results || []).map(serializeProperty) });
  } catch {
    return serverError();
  }
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requirePermission(env, request, 'properties_create');
  if (auth instanceof Response) return auth;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    if (!body.name || !body.address) {
      return jsonOk({ success: false, error: 'Name and address are required' }, 400);
    }

    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO properties (id, name, address, city, state, zip_code, type, description, purchase_date, purchase_price, user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        id,
        body.name,
        body.address,
        body.city ?? '',
        body.state ?? '',
        body.zipCode ?? '',
        body.type ?? 'house',
        body.description ?? null,
        body.purchaseDate ?? null,
        body.purchasePrice ?? null,
        auth.id
      )
      .run();

    const row = await env.DB.prepare('SELECT * FROM properties WHERE id = ?').bind(id).first();
    return jsonOk({ success: true, data: serializeProperty(row as Record<string, unknown>) }, 201);
  } catch {
    return serverError();
  }
};
