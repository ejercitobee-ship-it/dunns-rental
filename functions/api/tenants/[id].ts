import type { PagesFunction, D1PreparedStatement } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../lib/session';
import { serializeTenant } from '../../lib/serializers';
import { deleteUserStatements } from '../../lib/users';
import { soleOccupantLeaseIds, tenantWipeStatements } from '../../lib/tenants';
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
    const newEmail = (typeof body.email === 'string' && body.email.trim()) ? body.email.trim() : null;

    // Keep the tenant's portal LOGIN email in sync with their profile email, so
    // changing it here means they both receive AND sign in with the new address
    // (the password lives in `account` keyed by user_id, so it is unaffected).
    const linked = await env.DB.prepare('SELECT user_id FROM tenants WHERE id = ?')
      .bind(id).first<{ user_id: string | null }>();
    if (linked?.user_id && newEmail) {
      const clash = await env.DB.prepare('SELECT id FROM user WHERE email = ? AND id != ?')
        .bind(newEmail, linked.user_id).first();
      if (clash) return jsonError('That email is already used by another login account.', 409);
    }

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

    if (linked?.user_id && newEmail) {
      await env.DB.prepare('UPDATE user SET email = ?, updated_at = ? WHERE id = ?')
        .bind(newEmail, Math.floor(Date.now() / 1000), linked.user_id).run();
    }

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

    let statements: D1PreparedStatement[];
    if (auth.role === 'super_admin') {
      // Full wipe: free up the unit and remove every record of this tenant
      // (lease, all its rent, documents, login), leaving only their Drive
      // folder. A lease shared with a roommate is kept so the roommate's
      // tenancy survives — see tenantWipeStatements.
      const leaseRows = await env.DB.prepare(
        `SELECT lt.lease_id AS lease_id,
                (SELECT COUNT(*) FROM lease_tenants x WHERE x.lease_id = lt.lease_id) AS tenant_count
           FROM lease_tenants lt
          WHERE lt.tenant_id = ?`
      ).bind(id).all<{ lease_id: string; tenant_count: number }>();
      const soleLeaseIds = soleOccupantLeaseIds(leaseRows.results || []);
      statements = tenantWipeStatements(env, id, tenant.user_id, soleLeaseIds);
    } else {
      // A normal admin removes the person but keeps the lease and its payment
      // history (the confirm dialog says as much). Deleting the tenant cascades
      // lease_tenants and tenant_realtors and nulls rent_payments.paid_by_tenant_id.
      statements = [env.DB.prepare('DELETE FROM tenants WHERE id = ?').bind(id)];
      if (tenant.user_id) statements.push(...deleteUserStatements(env, tenant.user_id));
    }
    await env.DB.batch(statements);

    syncRentSheet(context);
    return jsonOk({ success: true });
  } catch {
    return serverError();
  }
};
