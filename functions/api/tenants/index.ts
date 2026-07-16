import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../lib/session';
import { serializeTenant } from '../../lib/serializers';

interface EmergencyContact {
  name?: string;
  phone?: string;
  relationship?: string;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requirePermission(env, request, 'tenants_view');
  if (auth instanceof Response) return auth;

  try {
    const { results } = await env.DB.prepare('SELECT * FROM tenants ORDER BY created_at DESC').all();
    return jsonOk({ success: true, data: (results || []).map(serializeTenant) });
  } catch {
    return serverError();
  }
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requirePermission(env, request, 'tenants_create');
  if (auth instanceof Response) return auth;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const ec = (body.emergencyContact as EmergencyContact) || {};

    if (!body.firstName || !body.lastName) {
      return jsonError('First and last name are required', 400);
    }

    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO tenants (id, first_name, last_name, email, phone, notes,
        emergency_contact_name, emergency_contact_phone, emergency_contact_relationship, user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        id,
        body.firstName,
        body.lastName,
        body.email ?? null,
        body.phone ?? null,
        body.notes ?? null,
        ec.name ?? null,
        ec.phone ?? null,
        ec.relationship ?? null,
        auth.id
      )
      .run();

    const row = await env.DB.prepare('SELECT * FROM tenants WHERE id = ?').bind(id).first();
    return jsonOk({ success: true, data: serializeTenant(row as Record<string, unknown>) }, 201);
  } catch {
    return serverError();
  }
};
