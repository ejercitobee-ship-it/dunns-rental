import type { PagesFunction, D1PreparedStatement } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../lib/session';
import { serializeTenant } from '../../lib/serializers';
import { deleteUserStatements } from '../../lib/users';
import { syncRentSheet } from '../../lib/sheets';

interface EmergencyContact {
  name?: string;
  phone?: string;
  relationship?: string;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'tenants_view');
  if (auth instanceof Response) return auth;

  try {
    const row = await env.DB.prepare('SELECT * FROM tenants WHERE id = ?')
      .bind(params.id as string)
      .first();
    if (!row) return jsonError('Tenant not found', 404);
    return jsonOk({ success: true, data: serializeTenant(row as Record<string, unknown>) });
  } catch {
    return serverError();
  }
};

export const onRequestPut: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'tenants_edit');
  if (auth instanceof Response) return auth;

  try {
    const id = params.id as string;
    const body = (await request.json()) as Record<string, unknown>;
    const ec = (body.emergencyContact as EmergencyContact) || {};

    await env.DB.prepare(
      `UPDATE tenants SET
        first_name = ?, last_name = ?, email = ?, phone = ?, notes = ?,
        emergency_contact_name = ?, emergency_contact_phone = ?, emergency_contact_relationship = ?,
        updated_at = unixepoch()
       WHERE id = ?`
    )
      .bind(
        body.firstName,
        body.lastName,
        body.email ?? null,
        body.phone ?? null,
        body.notes ?? null,
        ec.name ?? null,
        ec.phone ?? null,
        ec.relationship ?? null,
        id
      )
      .run();

    const row = await env.DB.prepare('SELECT * FROM tenants WHERE id = ?').bind(id).first();
    if (!row) return jsonError('Tenant not found', 404);
    syncRentSheet(context);
    return jsonOk({ success: true, data: serializeTenant(row as Record<string, unknown>) });
  } catch {
    return serverError();
  }
};

export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'tenants_delete');
  if (auth instanceof Response) return auth;

  try {
    const id = params.id as string;
    const tenant = await env.DB.prepare('SELECT user_id FROM tenants WHERE id = ?')
      .bind(id)
      .first<{ user_id: string | null }>();
    if (!tenant) return jsonError('Tenant not found', 404);

    // Deleting the tenant cascades lease_tenants and tenant_realtors and nulls
    // rent_payments.paid_by_tenant_id. A Super Admin additionally purges the
    // payment history recorded as paid by this person (done first, so the rows
    // are deleted rather than nulled by the cascade).
    const statements: D1PreparedStatement[] = [];
    if (auth.role === 'super_admin') {
      statements.push(env.DB.prepare('DELETE FROM rent_payments WHERE paid_by_tenant_id = ?').bind(id));
    }
    statements.push(env.DB.prepare('DELETE FROM tenants WHERE id = ?').bind(id));
    if (tenant.user_id) statements.push(...deleteUserStatements(env, tenant.user_id));
    await env.DB.batch(statements);

    syncRentSheet(context);
    return jsonOk({ success: true });
  } catch {
    return serverError();
  }
};
