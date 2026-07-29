import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../lib/session';
import { serializeProspective, validateProspective } from '../../lib/prospective';

/** GET /api/prospective-tenants — all applicants, newest first. */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requirePermission(env, request, 'tenants_view');
  if (auth instanceof Response) return auth;
  try {
    const { results } = await env.DB.prepare(
      'SELECT * FROM prospective_tenants ORDER BY created_at DESC'
    ).all();
    return jsonOk({ success: true, data: (results || []).map(serializeProspective) });
  } catch {
    return serverError();
  }
};

/** POST /api/prospective-tenants — add a new applicant (no portal login). */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requirePermission(env, request, 'tenants_create');
  if (auth instanceof Response) return auth;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const valid = validateProspective(body);
    if (!valid.ok) return jsonError(valid.error, 400);
    const v = valid.value;
    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO prospective_tenants (id, first_name, last_name, email, phone, notes)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(id, v.firstName, v.lastName, v.email, v.phone, v.notes).run();
    const row = await env.DB.prepare('SELECT * FROM prospective_tenants WHERE id = ?').bind(id).first();
    return jsonOk({ success: true, data: serializeProspective(row as Record<string, unknown>) }, 201);
  } catch {
    return serverError();
  }
};
