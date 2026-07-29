import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../lib/session';
import { serializeProspective, validateProspective, isProspectiveStatus, getProspective } from '../../lib/prospective';

/** GET /api/prospective-tenants/:id */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'tenants_view');
  if (auth instanceof Response) return auth;
  try {
    const row = await getProspective(env, params.id as string);
    if (!row) return jsonError('Applicant not found', 404);
    return jsonOk({ success: true, data: serializeProspective(row) });
  } catch {
    return serverError();
  }
};

/** PUT /api/prospective-tenants/:id — edit info and/or move the status. */
export const onRequestPut: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'tenants_edit');
  if (auth instanceof Response) return auth;
  try {
    const id = params.id as string;
    const existing = await getProspective(env, id);
    if (!existing) return jsonError('Applicant not found', 404);

    const body = (await request.json()) as Record<string, unknown>;
    const valid = validateProspective(body);
    if (!valid.ok) return jsonError(valid.error, 400);
    const v = valid.value;

    // Status is optional; a converted applicant cannot be moved back.
    let status = existing.status as string;
    if (body.status !== undefined) {
      if (!isProspectiveStatus(body.status)) return jsonError('Invalid status', 400);
      if (existing.status === 'converted') return jsonError('This applicant is already a tenant', 400);
      if (body.status === 'converted') return jsonError('Use Convert to make an applicant a tenant', 400);
      status = body.status;
    }

    await env.DB.prepare(
      `UPDATE prospective_tenants SET first_name = ?, last_name = ?, email = ?, phone = ?,
              notes = ?, status = ?, updated_at = unixepoch() WHERE id = ?`
    ).bind(v.firstName, v.lastName, v.email, v.phone, v.notes, status, id).run();

    const row = await getProspective(env, id);
    return jsonOk({ success: true, data: serializeProspective(row as Record<string, unknown>) });
  } catch {
    return serverError();
  }
};

/** DELETE /api/prospective-tenants/:id */
export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'tenants_delete');
  if (auth instanceof Response) return auth;
  try {
    await env.DB.prepare('DELETE FROM prospective_tenants WHERE id = ?').bind(params.id as string).run();
    return jsonOk({ success: true });
  } catch {
    return serverError();
  }
};
