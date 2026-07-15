import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../lib/session';
import { withTenantIds } from './index';

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

    await env.DB.prepare(
      `UPDATE leases SET
        unit_id = ?, property_id = ?, start_date = ?, end_date = ?, monthly_rent = ?,
        security_deposit = ?, status = ?, notes = ?, updated_at = unixepoch()
       WHERE id = ?`
    )
      .bind(
        body.unitId ?? null,
        body.propertyId ?? null,
        body.startDate ?? null,
        body.endDate ?? null,
        body.monthlyRent ?? 0,
        body.securityDeposit ?? 0,
        body.status ?? 'active',
        body.notes ?? null,
        id
      )
      .run();

    // Replace the occupant list when the caller sends one.
    if (Array.isArray(body.tenantIds)) {
      await env.DB.prepare('DELETE FROM lease_tenants WHERE lease_id = ?').bind(id).run();
      for (const tid of body.tenantIds as string[]) {
        await env.DB.prepare(
          'INSERT OR IGNORE INTO lease_tenants (id, lease_id, tenant_id) VALUES (?, ?, ?)'
        )
          .bind(crypto.randomUUID(), id, tid)
          .run();
      }
    }

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
