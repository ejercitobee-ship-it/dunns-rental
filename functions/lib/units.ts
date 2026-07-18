import type { Env } from './session';

const AVAILABLE_WHERE =
  `u.status != 'maintenance'
     AND NOT EXISTS (SELECT 1 FROM leases l WHERE l.unit_id = u.id AND l.status IN ('active','paused'))`;

/** Vacant units (no active/paused lease, not in maintenance) with their property. */
export async function availableUnits(env: Env) {
  const { results } = await env.DB.prepare(
    `SELECT u.id, u.unit_number, u.bedrooms, u.bathrooms, u.square_feet,
            u.monthly_rent, u.description,
            p.address, p.city, p.state, p.zip_code
       FROM units u
       JOIN properties p ON p.id = u.property_id
      WHERE ${AVAILABLE_WHERE}
      ORDER BY p.address, u.unit_number`
  ).all();
  return results || [];
}

/** Whether a single unit is currently available to place a tenant into. */
export async function isUnitAvailable(env: Env, unitId: string): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT 1 AS ok FROM units u WHERE u.id = ? AND ${AVAILABLE_WHERE}`
  ).bind(unitId).first<{ ok: number }>();
  return !!row;
}
