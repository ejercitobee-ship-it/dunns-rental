import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, jsonOk, jsonError, serverError } from '../../lib/session';
import { claimableTenantForUnit, createTenantLoginForSignup } from '../../lib/signup';

/**
 * POST /api/signup/claim — PUBLIC. A tenant claims their portal login for a
 * unit. Body: { unitId, lastName, email, password }. They prove who they are by
 * matching the LAST name of the person the office placed in that unit (the
 * last name is never sent to the client, so it acts as a shared secret), then
 * set the email + password they will sign in with.
 */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  try {
    const body = (await request.json()) as {
      unitId?: unknown;
      lastName?: unknown;
      email?: unknown;
      password?: unknown;
    };
    const unitId = typeof body.unitId === 'string' ? body.unitId : '';
    const lastName = typeof body.lastName === 'string' ? body.lastName.trim() : '';
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';

    if (!unitId || !lastName || !email || !password) {
      return jsonError('All fields are required', 400);
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return jsonError('Enter a valid email address', 400);
    }
    if (password.length < 8) {
      return jsonError('Password must be at least 8 characters', 400);
    }

    const tenant = await claimableTenantForUnit(env, unitId);
    if (!tenant) {
      return jsonError('This unit is not available for sign up. Please contact the office.', 404);
    }

    // The last-name gate. A generic message either way so a wrong guess cannot
    // confirm or deny anything about who lives there.
    if (tenant.lastName.trim().toLowerCase() !== lastName.toLowerCase()) {
      return jsonError('The last name does not match our records. Please contact the office.', 403);
    }

    const existing = await env.DB.prepare('SELECT id FROM user WHERE email = ?').bind(email).first();
    if (existing) {
      return jsonError('That email is already in use. If it is yours, sign in instead.', 409);
    }

    const name = `${tenant.firstName} ${tenant.lastName}`.trim();
    await createTenantLoginForSignup(env, tenant.id, name, email, password);

    return jsonOk({ success: true, data: { email } }, 201);
  } catch {
    return serverError();
  }
};
