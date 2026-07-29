import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requireUser, jsonOk, jsonError, serverError } from '../../../lib/session';
import { handymanForUser } from '../../../lib/portal';

/**
 * GET /api/portal/handyman/places — the minimal property + unit list a handyman
 * needs to say WHERE they did work when self-reporting. Deliberately tiny: names,
 * addresses, and unit numbers only, never financials or tenant data.
 */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requireUser(env, request);
  if (auth instanceof Response) return auth;
  if (auth.role !== 'handyman') return jsonError('Not a handyman account', 403);

  try {
    const handyman = await handymanForUser(env, auth.id);
    if (!handyman) return jsonError('No active handyman record is linked to this login', 404);

    const props = await env.DB.prepare('SELECT id, name, address FROM properties ORDER BY name').all<{ id: string; name: string; address: string }>();
    const units = await env.DB.prepare('SELECT id, property_id, unit_number FROM units ORDER BY unit_number').all<{ id: string; property_id: string; unit_number: string }>();

    return jsonOk({
      success: true,
      data: {
        properties: (props.results || []).map(p => ({ id: p.id, name: p.name, address: p.address })),
        units: (units.results || []).map(u => ({ id: u.id, propertyId: u.property_id, unitNumber: u.unit_number })),
      },
    });
  } catch {
    return serverError();
  }
};
