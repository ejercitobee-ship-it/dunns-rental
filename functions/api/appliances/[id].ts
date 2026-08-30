import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../lib/session';
import { serializeAppliance } from '../../lib/serializers';

const TYPES = [
  'refrigerator', 'stove_oven', 'dishwasher', 'washer', 'dryer',
  'hvac', 'water_heater', 'microwave', 'garbage_disposal', 'furnace',
  'air_conditioner', 'range_hood', 'freezer', 'other',
];

const CONDITIONS = ['excellent', 'good', 'fair', 'replace_soon'];

export const onRequestPut: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'properties_edit');
  if (auth instanceof Response) return auth;
  try {
    const id = params.id as string;
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
    await env.DB.prepare(
      `UPDATE appliances SET
        property_id = ?, unit_id = ?, type = ?, brand = ?, model_number = ?, serial_number = ?,
        purchase_date = ?, warranty_expiration = ?, condition = ?, notes = ?,
        updated_at = unixepoch()
       WHERE id = ?`
    ).bind(
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
      id,
    ).run();
    const row = await env.DB.prepare('SELECT * FROM appliances WHERE id = ?').bind(id).first();
    if (!row) return jsonError('Appliance not found', 404);
    return jsonOk({ success: true, data: serializeAppliance(row as Record<string, unknown>) });
  } catch {
    return serverError();
  }
};

export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'properties_edit');
  if (auth instanceof Response) return auth;
  try {
    await env.DB.prepare('DELETE FROM appliances WHERE id = ?').bind(params.id as string).run();
    return jsonOk({ success: true });
  } catch {
    return serverError();
  }
};
