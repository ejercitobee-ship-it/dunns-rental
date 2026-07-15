import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../lib/session';
import { withTenantIds, findMissingTenantIds } from './index';

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'tenants_view');
  if (auth instanceof Response) return auth;

  try {
    const row = await env.DB.prepare('SELECT * FROM leases WHERE id = ?')
      .bind(params.id as string)
      .first();
    if (!row) return jsonError('Lease not found', 404);
    const [data] = await withTenantIds(env, [row as Record<string, unknown>]);
    return jsonOk({ success: true, data });
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

    const tenantIds = Array.isArray(body.tenantIds) ? (body.tenantIds as string[]) : null;
    if (tenantIds && tenantIds.length) {
      const missing = await findMissingTenantIds(env, tenantIds);
      if (missing.length) return jsonError('One or more tenants could not be found', 400);
    }

    const statements = [
      env.DB.prepare(
        `UPDATE leases SET
          unit_id = ?, property_id = ?, start_date = ?, end_date = ?, monthly_rent = ?,
          security_deposit = ?, status = ?, notes = ?, updated_at = unixepoch()
         WHERE id = ?`
      ).bind(
        body.unitId ?? null,
        body.propertyId ?? null,
        body.startDate ?? null,
        body.endDate ?? null,
        body.monthlyRent ?? 0,
        body.securityDeposit ?? 0,
        body.status ?? 'active',
        body.notes ?? null,
        id
      ),
    ];

    // Replace the occupant list when the caller sends one.
    if (tenantIds) {
      statements.push(env.DB.prepare('DELETE FROM lease_tenants WHERE lease_id = ?').bind(id));
      for (const tid of tenantIds) {
        statements.push(
          env.DB.prepare(
            'INSERT OR IGNORE INTO lease_tenants (id, lease_id, tenant_id) VALUES (?, ?, ?)'
          ).bind(crypto.randomUUID(), id, tid)
        );
      }
    }

    await env.DB.batch(statements);

    const row = await env.DB.prepare('SELECT * FROM leases WHERE id = ?').bind(id).first();
    if (!row) return jsonError('Lease not found', 404);
    const [data] = await withTenantIds(env, [row as Record<string, unknown>]);
    return jsonOk({ success: true, data });
  } catch {
    return serverError();
  }
};

export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'tenants_delete');
  if (auth instanceof Response) return auth;

  try {
    await env.DB.prepare('DELETE FROM leases WHERE id = ?').bind(params.id as string).run();
    return jsonOk({ success: true });
  } catch {
    return serverError();
  }
};
