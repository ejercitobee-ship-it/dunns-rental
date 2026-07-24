import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, jsonOk, serverError } from '../../lib/session';
import { claimableUnits } from '../../lib/signup';

/**
 * GET /api/signup/units — PUBLIC. The units a tenant can claim a portal login
 * for: each has a person the office added who has no login yet. Returns only
 * property, unit, and the tenant's first name (never the last name or email),
 * so it is safe to serve without auth.
 */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env } = context;
  try {
    return jsonOk({ success: true, data: await claimableUnits(env) });
  } catch {
    return serverError();
  }
};
