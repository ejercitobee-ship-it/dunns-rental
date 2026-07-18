import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../lib/session';
import { validateHouseholdInput } from '../../lib/household';
import { serializeHouseholdMember } from '../../lib/serializers';

// PUT /api/household/:id — edit a member.
export const onRequestPut: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'tenants_edit');
  if (auth instanceof Response) return auth;

  try {
    const id = params.id as string;
    const existing = await env.DB.prepare('SELECT id FROM household_members WHERE id = ?').bind(id).first();
    if (!existing) return jsonError('Household member not found', 404);

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

// DELETE /api/household/:id — remove a member.
export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'tenants_edit');
  if (auth instanceof Response) return auth;

  try {
    const id = params.id as string;
    const existing = await env.DB.prepare('SELECT id FROM household_members WHERE id = ?').bind(id).first();
    if (!existing) return jsonError('Household member not found', 404);
    await env.DB.prepare('DELETE FROM household_members WHERE id = ?').bind(id).run();
    return jsonOk({ success: true });
  } catch {
    return serverError();
  }
};
