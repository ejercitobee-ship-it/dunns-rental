import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../lib/session';
import { serializeUnit } from '../../lib/serializers';

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requirePermission(env, request, 'units_view');
  if (auth instanceof Response) return auth;

  try {
    const { results } = await env.DB.prepare(
      'SELECT * FROM units ORDER BY created_at DESC'
    ).all();
    return jsonOk({ success: true, data: (results || []).map(serializeUnit) });
  } catch {
    return serverError();
  }
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requirePermission(env, request, 'units_create');
  if (auth instanceof Response) return auth;

  try {
    const body = (await request.json()) as Record<string, unknown>;

    if (!body.propertyId) {
      return jsonError('propertyId is required', 400);
    }
    const property = await env.DB.prepare('SELECT id FROM properties WHERE id = ?')
      .bind(body.propertyId)
      .first();
    if (!property) {
      return jsonError('Property not found', 404);
    }

    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO units (id, property_id, unit_number, bedrooms, bathrooms, square_feet, monthly_rent, description, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())`
    )
      .bind(
        id,
        body.propertyId,
        body.unitNumber ?? '',
        body.bedrooms ?? 1,
        body.bathrooms ?? 1,
        body.squareFeet ?? 0,
        body.monthlyRent ?? 0,
        body.description ?? null,
        body.status ?? 'vacant'
      )
      .run();

    const row = await env.DB.prepare('SELECT * FROM units WHERE id = ?').bind(id).first();
    return jsonOk({ success: true, data: serializeUnit(row as Record<string, unknown>) }, 201);
  } catch {
    return serverError();
  }
};
