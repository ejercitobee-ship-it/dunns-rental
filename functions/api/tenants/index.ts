import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../lib/session';
import { serializeTenant } from '../../lib/serializers';
import { syncRentSheet } from '../../lib/sheets';

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
    // ?withoutRealtor=1 returns only tenants not linked to any realtor, for the
    // admin "link an existing tenant to a realtor" picker. Kept as a query param
    // on this collection route (rather than a /tenants/unlinked file) so it can
    // never be shadowed by the dynamic /tenants/[id] route.
    const withoutRealtor = new URL(request.url).searchParams.get('withoutRealtor') === '1';
    const sql = withoutRealtor
      ? `SELECT * FROM tenants WHERE id NOT IN (SELECT tenant_id FROM tenant_realtors) ORDER BY last_name, first_name`
      : 'SELECT * FROM tenants ORDER BY created_at DESC';
    const { results } = await env.DB.prepare(sql).all();
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

    // user_id is deliberately NOT set here. It means "this person's own portal
    // login" and is filled in only when the tenant is invited to the portal.
    // It used to be bound to auth.id, the staff member who created the record,
    // which put one admin's id on every tenant row. The portal resolves a
    // tenant with `WHERE user_id = ?` and takes the first match, so that would
    // have handed whoever it matched an arbitrary tenant's documents.
    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO tenants (id, first_name, last_name, email, phone, notes,
        emergency_contact_name, emergency_contact_phone, emergency_contact_relationship)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
        ec.relationship ?? null
      )
      .run();

    const row = await env.DB.prepare('SELECT * FROM tenants WHERE id = ?').bind(id).first();
    syncRentSheet(context);
    return jsonOk({ success: true, data: serializeTenant(row as Record<string, unknown>) }, 201);
  } catch {
    return serverError();
  }
};
