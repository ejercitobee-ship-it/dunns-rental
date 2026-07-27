import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../lib/session';
import { serializeLease } from '../../lib/serializers';
import { syncRentSheet } from '../../lib/sheets';

/**
 * Attach the tenant ids and pause intervals on each lease, in two extra
 * queries (one for lease_tenants, one for lease_pauses), then serialize.
 * Both are one-to-many joins done in a single SELECT and grouped in memory
 * rather than N+1 queries, the same way lease_tenants was already loaded.
 * Pauses are ordered by paused_at so a lease that was paused more than once
 * shows its intervals oldest first.
 */
export async function withLeaseDetails(env: Env, rows: Record<string, unknown>[]) {
  if (!rows.length) return [];

  const { results: tenantLinks } = await env.DB.prepare(
    'SELECT lease_id, tenant_id FROM lease_tenants'
  ).all<{ lease_id: string; tenant_id: string }>();
  const tenantsByLease = new Map<string, string[]>();
  for (const link of tenantLinks || []) {
    const list = tenantsByLease.get(link.lease_id) || [];
    list.push(link.tenant_id);
    tenantsByLease.set(link.lease_id, list);
  }

  const { results: pauseRows } = await env.DB.prepare(
    'SELECT lease_id, paused_at, resumed_at FROM lease_pauses ORDER BY paused_at'
  ).all<{ lease_id: string; paused_at: string; resumed_at: string | null }>();
  const pausesByLease = new Map<string, { pausedAt: string; resumedAt?: string }[]>();
  for (const p of pauseRows || []) {
    const list = pausesByLease.get(p.lease_id) || [];
    list.push({ pausedAt: p.paused_at, resumedAt: p.resumed_at ?? undefined });
    pausesByLease.set(p.lease_id, list);
  }

  return rows.map(r =>
    serializeLease({
      ...r,
      tenantIds: tenantsByLease.get(r.id as string) || [],
      pauses: pausesByLease.get(r.id as string) || [],
    })
  );
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requirePermission(env, request, 'tenants_view');
  if (auth instanceof Response) return auth;

  try {
    const { results } = await env.DB.prepare('SELECT * FROM leases ORDER BY created_at DESC').all();
    return jsonOk({ success: true, data: await withLeaseDetails(env, results || []) });
  } catch {
    return serverError();
  }
};

/**
 * Strict `YYYY-MM-DD`, no `Date` parsing involved. Used to validate any date
 * the client sends for stamping a pause interval (`statusChangedOn` on the
 * PUT, or an imported lease's `pausedAt` on the POST) so a malformed value
 * 400s instead of writing a row the month math in `leasesOwingMonth` would
 * silently misread.
 */
export function isValidDateString(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/**
 * The only three states a lease can be in. The column has a matching CHECK
 * constraint, so this whitelist is what turns a bad value into a clean 400
 * instead of a raw D1 constraint error surfacing as a 500.
 */
export const LEASE_STATUSES = ['active', 'paused', 'ended'] as const;

/**
 * Resolve the status off a request body. Returns null when the caller sent
 * something that is not one of the three states, which the endpoints turn
 * into a 400. An absent status defaults to 'active', as it always has.
 */
export function readLeaseStatus(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return 'active';
  return (LEASE_STATUSES as readonly string[]).includes(value as string) ? (value as string) : null;
}

/**
 * The lease's end date: the caller's value when given, otherwise ONE YEAR after
 * the start date so every lease has a yearly expiration. Null only when there is
 * no start date yet (a realtor draft awaiting approval).
 */
export function leaseEndDate(startDate: unknown, endDate: unknown): string | null {
  if (isValidDateString(endDate)) return endDate;
  if (isValidDateString(startDate)) {
    const [y, m, d] = startDate.split('-');
    return `${Number(y) + 1}-${m}-${d}`;
  }
  return null;
}

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
    const status = readLeaseStatus(body.status);
    if (status === null) {
      return jsonError('Status must be one of: active, paused, ended', 400);
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

    // Only the CSV importer sends this: a paused lease being imported has no
    // way to say the pause already closed, so this always opens a NEW
    // interval (resumed_at NULL). A regular create from the UI never sends
    // pausedAt at all.
    if (body.pausedAt !== undefined && body.pausedAt !== null && !isValidDateString(body.pausedAt)) {
      return jsonError('pausedAt must be YYYY-MM-DD', 400);
    }

    const id = crypto.randomUUID();
    const statements = [
      env.DB.prepare(
        `INSERT INTO leases (id, unit_id, property_id, start_date, end_date, monthly_rent, security_deposit, move_in_fee_paid, status, notes, user_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        id,
        body.unitId,
        body.propertyId ?? unit.property_id ?? null,
        body.startDate ?? null,
        leaseEndDate(body.startDate, body.endDate),
        body.monthlyRent,
        body.securityDeposit ?? 0,
        body.moveInFeePaid === false ? 0 : 1,
        status,
        body.notes ?? null,
        auth.id
      ),
      ...tenantIds.map(tid =>
        env.DB.prepare(
          'INSERT OR IGNORE INTO lease_tenants (id, lease_id, tenant_id) VALUES (?, ?, ?)'
        ).bind(crypto.randomUUID(), id, tid)
      ),
      ...(isValidDateString(body.pausedAt)
        ? [
            env.DB.prepare(
              'INSERT INTO lease_pauses (id, lease_id, paused_at, resumed_at) VALUES (?, ?, ?, NULL)'
            ).bind(crypto.randomUUID(), id, body.pausedAt),
          ]
        : []),
    ];
    await env.DB.batch(statements);

    const row = await env.DB.prepare('SELECT * FROM leases WHERE id = ?').bind(id).first();
    const [data] = await withLeaseDetails(env, [row as Record<string, unknown>]);
    syncRentSheet(context);
    return jsonOk({ success: true, data }, 201);
  } catch {
    return serverError();
  }
};
