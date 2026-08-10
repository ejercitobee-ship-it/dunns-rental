import type { Env } from './session';

// A unit is available when it has no active/paused lease, OR when its only
// active lease has a scheduled termination (end_date + end_reason set). A
// paused lease always blocks: someone is still living there.
const AVAILABLE_WHERE =
  `u.status != 'maintenance'
     AND NOT EXISTS (
       SELECT 1 FROM leases l
        WHERE l.unit_id = u.id
          AND l.status IN ('active','paused')
          AND NOT (l.status = 'active' AND l.end_date IS NOT NULL AND l.end_reason IS NOT NULL)
     )`;

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
