import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requireUser, jsonOk, jsonError, serverError } from '../../../lib/session';
import { tenantIdForUser, currentLeaseId } from '../../../lib/portal';
import { validateHouseholdInput, MAX_HOUSEHOLD_MEMBERS } from '../../../lib/household';
import { serializeHouseholdMember } from '../../../lib/serializers';

// GET /api/portal/household — the caller's own current-lease household.
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requireUser(env, request);
  if (auth instanceof Response) return auth;

  try {
    const tenantId = await tenantIdForUser(env, auth.id);
    if (!tenantId) return jsonOk({ success: true, data: [] }); // realtors and others: none
    const leaseId = await currentLeaseId(env, tenantId);
    if (!leaseId) return jsonOk({ success: true, data: [] });

    const { results } = await env.DB.prepare(
      'SELECT * FROM household_members WHERE lease_id = ? ORDER BY created_at'
    ).bind(leaseId).all();
    return jsonOk({ success: true, data: (results || []).map(serializeHouseholdMember) });
  } catch {
    return serverError();
  }
};

// POST /api/portal/household — add a member to the caller's current lease.
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requireUser(env, request);
  if (auth instanceof Response) return auth;

  try {
    const tenantId = await tenantIdForUser(env, auth.id);
    if (!tenantId) return jsonError('Only a tenant can manage a household', 403);
    const leaseId = await currentLeaseId(env, tenantId);
    if (!leaseId) return jsonError('You have no active lease', 400);

    const valid = validateHouseholdInput((await request.json()) as Record<string, unknown>);
    if (!valid.ok) return jsonError(valid.error, 400);

    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM household_members WHERE lease_id = ?')
      .bind(leaseId).first<{ n: number }>();
    if ((count?.n ?? 0) >= MAX_HOUSEHOLD_MEMBERS) {
      return jsonError('You have reached the maximum number of household members', 400);
    }

    const id = crypto.randomUUID();
    await env.DB.prepare(
      'INSERT INTO household_members (id, lease_id, name, phone, relationship) VALUES (?, ?, ?, ?, ?)'
    ).bind(id, leaseId, valid.value.name, valid.value.phone, valid.value.relationship).run();

    const row = await env.DB.prepare('SELECT * FROM household_members WHERE id = ?').bind(id).first();
    return jsonOk({ success: true, data: serializeHouseholdMember(row as Record<string, unknown>) }, 201);
  } catch {
    return serverError();
  }
};
