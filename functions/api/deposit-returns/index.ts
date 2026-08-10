import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../lib/session';
import { serializeDepositReturn } from '../../lib/serializers';

/** List deposit returns, optionally filtered by ?leaseId= or ?status= */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requirePermission(env, request, 'finances_view');
  if (auth instanceof Response) return auth;

  try {
    const url = new URL(request.url);
    const leaseId = url.searchParams.get('leaseId');
    const tenantId = url.searchParams.get('tenantId');
    const status = url.searchParams.get('status');

    let sql = 'SELECT dr.*, t.first_name || \' \' || t.last_name AS tenant_name, p.name AS property_name, u.unit_number FROM deposit_returns dr LEFT JOIN tenants t ON dr.tenant_id = t.id LEFT JOIN properties p ON dr.property_id = p.id LEFT JOIN units u ON dr.unit_id = u.id WHERE 1=1';
    const binds: unknown[] = [];

    if (leaseId) {
      sql += ' AND dr.lease_id = ?';
      binds.push(leaseId);
    }
    if (tenantId) {
      sql += ' AND dr.tenant_id = ?';
      binds.push(tenantId);
    }
    if (status) {
      sql += ' AND dr.status = ?';
      binds.push(status);
    }

    sql += ' ORDER BY dr.created_at DESC';

    const { results } = await env.DB.prepare(sql).bind(...binds).all();
    const returns = (results || []).map((r) => ({
      ...serializeDepositReturn(r as Record<string, unknown>),
      tenantName: r.tenant_name ?? undefined,
      propertyName: r.property_name ?? undefined,
      unitNumber: r.unit_number ?? undefined,
    }));
    return jsonOk({ success: true, data: returns });
  } catch {
    return serverError();
  }
};

/** Create a new deposit return record. */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requirePermission(env, request, 'finances_income');
  if (auth instanceof Response) return auth;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    if (!body.leaseId || !body.moveOutDate || body.depositAmount === undefined) {
      return jsonError('leaseId, moveOutDate, and depositAmount are required', 400);
    }

    const depositAmount = Number(body.depositAmount);
    if (!Number.isFinite(depositAmount) || depositAmount < 0) {
      return jsonError('depositAmount must be a non-negative number', 400);
    }

    const id = crypto.randomUUID();
    const moveOutDate = body.moveOutDate as string;
    const deadlineDate = body.deadlineDate as string || calculateDeadline(moveOutDate);

    await env.DB.prepare(
      `INSERT INTO deposit_returns (id, lease_id, tenant_id, property_id, unit_id, deposit_amount, move_out_date, deadline_date, status, total_deductions, refund_amount, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)`
    )
      .bind(
        id,
        body.leaseId,
        body.tenantId ?? null,
        body.propertyId ?? null,
        body.unitId ?? null,
        depositAmount,
        moveOutDate,
        deadlineDate,
        depositAmount, // refund_amount starts as full deposit
        body.notes ?? null,
      )
      .run();

    const row = await env.DB.prepare(
      'SELECT dr.*, t.first_name || \' \' || t.last_name AS tenant_name, p.name AS property_name, u.unit_number FROM deposit_returns dr LEFT JOIN tenants t ON dr.tenant_id = t.id LEFT JOIN properties p ON dr.property_id = p.id LEFT JOIN units u ON dr.unit_id = u.id WHERE dr.id = ?'
    ).bind(id).first();
    if (!row) return serverError();

    return jsonOk({
      success: true,
      data: {
        ...serializeDepositReturn(row as Record<string, unknown>),
        tenantName: row.tenant_name ?? undefined,
        propertyName: row.property_name ?? undefined,
        unitNumber: row.unit_number ?? undefined,
        deductions: [],
      },
    }, 201);
  } catch {
    return serverError();
  }
};

/** Illinois: 30 days for 5+ unit buildings, 45 days otherwise. Default to 30. */
function calculateDeadline(moveOutDate: string): string {
  const d = new Date(moveOutDate + 'T00:00:00');
  d.setDate(d.getDate() + 30);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
