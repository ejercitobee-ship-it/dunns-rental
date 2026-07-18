import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requireUser, jsonOk, jsonError, serverError } from '../../../lib/session';
import { availableUnits } from '../../../lib/units';

// GET /api/portal/realtor/available-units. Vacant units a realtor may market.
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requireUser(env, request);
  if (auth instanceof Response) return auth;
  if (auth.role !== 'realtor') return jsonError('Not a realtor account', 403);

  try {
    const rows = await availableUnits(env);
    return jsonOk({
      success: true,
      data: rows.map(r => {
        const u = r as Record<string, unknown>;
        return {
          id: u.id,
          unitNumber: u.unit_number,
          bedrooms: u.bedrooms,
          bathrooms: u.bathrooms,
          squareFeet: u.square_feet,
          monthlyRent: u.monthly_rent,
          description: u.description ?? undefined,
          address: u.address ?? undefined,
          city: u.city ?? undefined,
          state: u.state ?? undefined,
          zipCode: u.zip_code ?? undefined,
        };
      }),
    });
  } catch {
    return serverError();
  }
};
