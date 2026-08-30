import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../lib/session';
import { serializeAppliance } from '../../lib/serializers';

const TYPES = [
  'refrigerator', 'stove_oven', 'dishwasher', 'washer', 'dryer',
  'hvac', 'water_heater', 'microwave', 'garbage_disposal', 'furnace',
  'air_conditioner', 'range_hood', 'freezer', 'other',
];

const CONDITIONS = ['excellent', 'good', 'fair', 'replace_soon'];

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requirePermission(env, request, 'properties_view');
  if (auth instanceof Response) return auth;
  try {
    const url = new URL(request.url);
    const propertyId = url.searchParams.get('propertyId');
    const query = propertyId
      ? 'SELECT * FROM appliances WHERE property_id = ? ORDER BY type, created_at DESC'
      : 'SELECT * FROM appliances ORDER BY type, created_at DESC';
    const stmt = propertyId ? env.DB.prepare(query).bind(propertyId) : env.DB.prepare(query);
    const { results } = await stmt.all();
    return jsonOk({ success: true, data: (results || []).map(r => serializeAppliance(r as Record<string, unknown>)) });
  } catch {
    return serverError();
  }
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requirePermission(env, request, 'properties_edit');
  if (auth instanceof Response) return auth;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    if (!body.propertyId || !body.type) {
      return jsonError('Property and appliance type are required', 400);
    }
    if (!TYPES.includes(String(body.type))) {
      return jsonError(`Invalid appliance type. Valid types: ${TYPES.join(', ')}`, 400);
    }
    if (body.condition && !CONDITIONS.includes(String(body.condition))) {
      return jsonError(`Invalid condition. Valid values: ${CONDITIONS.join(', ')}`, 400);
    }
    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO appliances (id, property_id, unit_id, type, brand, model_number, serial_number,
        purchase_date, warranty_expiration, condition, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id,
      body.propertyId,
      body.unitId ?? null,
      body.type,
      body.brand ?? null,
      body.modelNumber ?? null,
      body.serialNumber ?? null,
      body.purchaseDate ?? null,
      body.warrantyExpiration ?? null,
      body.condition ?? 'good',
      body.notes ?? null,
    ).run();
    const row = await env.DB.prepare('SELECT * FROM appliances WHERE id = ?').bind(id).first();
    return jsonOk({ success: true, data: serializeAppliance(row as Record<string, unknown>) }, 201);
  } catch {
    return serverError();
  }
};
