import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../lib/session';
import { currentLeaseId } from '../../lib/portal';
import { validateHouseholdInput, MAX_HOUSEHOLD_MEMBERS } from '../../lib/household';
import { serializeHouseholdMember } from '../../lib/serializers';

// GET /api/household?tenantId=... — household of the tenant's current lease.
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requirePermission(env, request, 'tenants_view');
  if (auth instanceof Response) return auth;

  try {
    const tenantId = new URL(request.url).searchParams.get('tenantId');
    if (!tenantId) return jsonError('A tenant is required', 400);
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

// POST /api/household — add a member to the tenant's current lease.
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requirePermission(env, request, 'tenants_edit');
  if (auth instanceof Response) return auth;

  try {
    const body = (await request.json()) as { tenantId?: string; name?: unknown; phone?: unknown; relationship?: unknown };
    if (!body.tenantId) return jsonError('A tenant is required', 400);
    const leaseId = await currentLeaseId(env, body.tenantId);
    if (!leaseId) return jsonError('This tenant has no active lease', 400);

    const valid = validateHouseholdInput(body);
    if (!valid.ok) return jsonError(valid.error, 400);

    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM household_members WHERE lease_id = ?')
      .bind(leaseId).first<{ n: number }>();
    if ((count?.n ?? 0) >= MAX_HOUSEHOLD_MEMBERS) {
      return jsonError('This unit already has the maximum number of household members', 400);
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
