import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requireUser, jsonOk, jsonError, serverError } from '../../../../lib/session';
import { realtorTenantIds, serverToday } from '../../../../lib/portal';
import { validateHouseholdInput } from '../../../../lib/household';
import { serializeHouseholdMember } from '../../../../lib/serializers';

async function memberBelongsToRealtor(env: Env, memberId: string, realtorUserId: string): Promise<boolean> {
  const member = await env.DB.prepare(
    `SELECT lt.tenant_id
       FROM household_members hm
       JOIN lease_tenants lt ON lt.lease_id = hm.lease_id
      WHERE hm.id = ?
      LIMIT 1`
  ).bind(memberId).first<{ tenant_id: string }>();
  if (!member) return false;

  const ids = await realtorTenantIds(env, realtorUserId, serverToday());
  return ids.includes(member.tenant_id);
}

export const onRequestPut: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requireUser(env, request);
  if (auth instanceof Response) return auth;
  if (auth.role !== 'realtor') return jsonError('Not a realtor account', 403);

  try {
    const id = params.id as string;
    if (!(await memberBelongsToRealtor(env, id, auth.id))) return jsonError('Household member not found', 404);

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

export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requireUser(env, request);
  if (auth instanceof Response) return auth;
  if (auth.role !== 'realtor') return jsonError('Not a realtor account', 403);

  try {
    const id = params.id as string;
    if (!(await memberBelongsToRealtor(env, id, auth.id))) return jsonError('Household member not found', 404);

    await env.DB.prepare('DELETE FROM household_members WHERE id = ?').bind(id).run();
    return jsonOk({ success: true });
  } catch {
    return serverError();
  }
};
