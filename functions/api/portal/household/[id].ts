import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requireUser, jsonOk, jsonError, serverError } from '../../../lib/session';
import { tenantIdForUser, tenantLeaseIds } from '../../../lib/portal';
import { validateHouseholdInput } from '../../../lib/household';
import { serializeHouseholdMember } from '../../../lib/serializers';

/**
 * Load a member only if it belongs to a lease the caller is on. Returns null
 * both when the member is missing and when it is out of scope, so the caller
 * answers 404 either way and cannot probe which member ids exist.
 */
async function ownMemberLeaseId(env: Env, callerTenantId: string, memberId: string): Promise<string | null> {
  const member = await env.DB.prepare('SELECT lease_id FROM household_members WHERE id = ?')
    .bind(memberId).first<{ lease_id: string }>();
  if (!member) return null;
  const leases = await tenantLeaseIds(env, callerTenantId);
  return leases.includes(member.lease_id) ? member.lease_id : null;
}

// PUT /api/portal/household/:id — edit a member on the caller's own lease.
export const onRequestPut: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requireUser(env, request);
  if (auth instanceof Response) return auth;

  try {
    const tenantId = await tenantIdForUser(env, auth.id);
    if (!tenantId) return jsonError('Household member not found', 404);
    const id = params.id as string;
    if (!(await ownMemberLeaseId(env, tenantId, id))) return jsonError('Household member not found', 404);

    const valid = validateHouseholdInput((await request.json()) as Record<string, unknown>);
    if (!valid.ok) return jsonError(valid.error, 400);

    await env.DB.prepare(
      'UPDATE household_members SET name = ?, phone = ?, relationship = ?, updated_at = unixepoch() WHERE id = ?'
    ).bind(valid.value.name, valid.value.phone, valid.value.relationship, id).run();

    const row = await env.DB.prepare('SELECT * FROM household_members WHERE id = ?').bind(id).first();
    return jsonOk({ success: true, data: serializeHouseholdMember(row as Record<string, unknown>) });
  } catch {
    return serverError();
  }
};

// DELETE /api/portal/household/:id — remove a member on the caller's own lease.
export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requireUser(env, request);
  if (auth instanceof Response) return auth;

  try {
    const tenantId = await tenantIdForUser(env, auth.id);
    if (!tenantId) return jsonError('Household member not found', 404);
    const id = params.id as string;
    if (!(await ownMemberLeaseId(env, tenantId, id))) return jsonError('Household member not found', 404);

    await env.DB.prepare('DELETE FROM household_members WHERE id = ?').bind(id).run();
    return jsonOk({ success: true });
  } catch {
    return serverError();
  }
};
