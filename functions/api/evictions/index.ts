import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../lib/session';
import { serializeEviction } from '../../lib/serializers';

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requirePermission(env, request, 'evictions_view');
  if (auth instanceof Response) return auth;

  try {
    const url = new URL(request.url);
    const tenantId = url.searchParams.get('tenantId');
    const status = url.searchParams.get('status');

    let sql = `SELECT e.*, t.first_name || ' ' || t.last_name AS tenant_name,
               p.name AS property_name, u.unit_number,
               (SELECT COALESCE(SUM(ec.amount), 0) FROM eviction_costs ec WHERE ec.eviction_id = e.id) AS total_costs
               FROM evictions e
               LEFT JOIN tenants t ON e.tenant_id = t.id
               LEFT JOIN properties p ON e.property_id = p.id
               LEFT JOIN units u ON e.unit_id = u.id
               WHERE 1=1`;
    const binds: unknown[] = [];

    if (tenantId) { sql += ' AND e.tenant_id = ?'; binds.push(tenantId); }
    if (status) { sql += ' AND e.status = ?'; binds.push(status); }

    sql += ' ORDER BY e.created_at DESC';

    const { results } = await env.DB.prepare(sql).bind(...binds).all();
    const evictions = (results || []).map((r) => ({
      ...serializeEviction(r as Record<string, unknown>),
      tenantName: r.tenant_name ?? undefined,
      propertyName: r.property_name ?? undefined,
      unitNumber: r.unit_number ?? undefined,
      totalCosts: Number(r.total_costs ?? 0),
    }));
    return jsonOk({ success: true, data: evictions });
  } catch {
    return serverError();
  }
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requirePermission(env, request, 'evictions_manage');
  if (auth instanceof Response) return auth;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    if (!body.tenantId || !body.reason) {
      return jsonError('tenantId and reason are required', 400);
    }

    const id = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);
    await env.DB.prepare(
      `INSERT INTO evictions (id, tenant_id, lease_id, property_id, unit_id, status, reason, reason_notes,
       notice_served_date, filed_date, court_date, judgment_date, vacate_by_date,
       lawyer_name, lawyer_phone, case_number, court_name, notes, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        id,
        body.tenantId,
        body.leaseId ?? null,
        body.propertyId ?? null,
        body.unitId ?? null,
        body.status ?? 'notice_served',
        body.reason,
        body.reasonNotes ?? null,
        body.noticeServedDate ?? null,
        body.filedDate ?? null,
        body.courtDate ?? null,
        body.judgmentDate ?? null,
        body.vacateByDate ?? null,
        body.lawyerName ?? null,
        body.lawyerPhone ?? null,
        body.caseNumber ?? null,
        body.courtName ?? null,
        body.notes ?? null,
        auth.id,
        now,
        now,
      )
      .run();

    return jsonOk({ success: true, data: { id } }, 201);
  } catch {
    return serverError();
  }
};
