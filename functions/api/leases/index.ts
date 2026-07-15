import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../lib/session';
import { serializeLease } from '../../lib/serializers';

/** Attach the tenant ids on each lease in one extra query. */
export async function withTenantIds(env: Env, rows: Record<string, unknown>[]) {
  if (!rows.length) return [];
  const { results } = await env.DB.prepare('SELECT lease_id, tenant_id FROM lease_tenants').all<{
    lease_id: string;
    tenant_id: string;
  }>();
  const byLease = new Map<string, string[]>();
  for (const link of results || []) {
    const list = byLease.get(link.lease_id) || [];
    list.push(link.tenant_id);
    byLease.set(link.lease_id, list);
  }
  return rows.map(r =>
    serializeLease({ ...r, tenantIds: byLease.get(r.id as string) || [] })
  );
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requirePermission(env, request, 'tenants_view');
  if (auth instanceof Response) return auth;

  try {
    const { results } = await env.DB.prepare('SELECT * FROM leases ORDER BY created_at DESC').all();
    return jsonOk({ success: true, data: await withTenantIds(env, results || []) });
  } catch {
    return serverError();
  }
};

/**
 * Confirm every id in tenantIds exists in tenants, in one query. Returns the
 * ids that could NOT be found (empty when all are valid).
 */
export async function findMissingTenantIds(env: Env, tenantIds: string[]): Promise<string[]> {
  if (!tenantIds.length) return [];
  const placeholders = tenantIds.map(() => '?').join(', ');
  const { results } = await env.DB.prepare(
    `SELECT id FROM tenants WHERE id IN (${placeholders})`
  )
    .bind(...tenantIds)
    .all<{ id: string }>();
  const found = new Set((results || []).map(r => r.id));
  return tenantIds.filter(tid => !found.has(tid));
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requirePermission(env, request, 'tenants_create');
  if (auth instanceof Response) return auth;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    if (!body.unitId) return jsonError('A unit is required', 400);
    if (body.monthlyRent === undefined || body.monthlyRent === null) {
      return jsonError('Monthly rent is required', 400);
    }

    const unit = await env.DB.prepare('SELECT id, property_id FROM units WHERE id = ?')
      .bind(body.unitId)
      .first<{ id: string; property_id: string }>();
    if (!unit) return jsonError('Unit not found', 404);

    const tenantIds = Array.isArray(body.tenantIds) ? (body.tenantIds as string[]) : [];
    if (tenantIds.length) {
      const missing = await findMissingTenantIds(env, tenantIds);
      if (missing.length) return jsonError('One or more tenants could not be found', 400);
    }

    const id = crypto.randomUUID();
    const statements = [
      env.DB.prepare(
        `INSERT INTO leases (id, unit_id, property_id, start_date, end_date, monthly_rent, security_deposit, status, notes, user_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        id,
        body.unitId,
        body.propertyId ?? unit.property_id ?? null,
        body.startDate ?? null,
        body.endDate ?? null,
        body.monthlyRent,
        body.securityDeposit ?? 0,
        body.status ?? 'active',
        body.notes ?? null,
        auth.id
      ),
      ...tenantIds.map(tid =>
        env.DB.prepare(
          'INSERT OR IGNORE INTO lease_tenants (id, lease_id, tenant_id) VALUES (?, ?, ?)'
        ).bind(crypto.randomUUID(), id, tid)
      ),
    ];
    await env.DB.batch(statements);

    const row = await env.DB.prepare('SELECT * FROM leases WHERE id = ?').bind(id).first();
    const [data] = await withTenantIds(env, [row as Record<string, unknown>]);
    return jsonOk({ success: true, data }, 201);
  } catch {
    return serverError();
  }
};
