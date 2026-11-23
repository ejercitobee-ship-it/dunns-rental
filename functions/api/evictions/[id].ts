import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../lib/session';
import { serializeEviction, serializeEvictionCost } from '../../lib/serializers';

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'evictions_view');
  if (auth instanceof Response) return auth;

  try {
    const id = params.id as string;
    const row = await env.DB.prepare(
      `SELECT e.*, t.first_name || ' ' || t.last_name AS tenant_name,
       p.name AS property_name, u.unit_number
       FROM evictions e
       LEFT JOIN tenants t ON e.tenant_id = t.id
       LEFT JOIN properties p ON e.property_id = p.id
       LEFT JOIN units u ON e.unit_id = u.id
       WHERE e.id = ?`
    ).bind(id).first();
    if (!row) return jsonError('Eviction not found', 404);

    const { results: costRows } = await env.DB.prepare(
      'SELECT * FROM eviction_costs WHERE eviction_id = ? ORDER BY cost_date DESC'
    ).bind(id).all();

    const eviction = {
      ...serializeEviction(row as Record<string, unknown>),
      tenantName: row.tenant_name ?? undefined,
      propertyName: row.property_name ?? undefined,
      unitNumber: row.unit_number ?? undefined,
      costs: (costRows || []).map(r => serializeEvictionCost(r as Record<string, unknown>)),
    };

    return jsonOk({ success: true, data: eviction });
  } catch {
    return serverError();
  }
};

export const onRequestPut: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'evictions_manage');
  if (auth instanceof Response) return auth;

  try {
    const id = params.id as string;
    const existing = await env.DB.prepare('SELECT id FROM evictions WHERE id = ?').bind(id).first();
    if (!existing) return jsonError('Eviction not found', 404);

    const body = (await request.json()) as Record<string, unknown>;
    const now = Math.floor(Date.now() / 1000);

    await env.DB.prepare(
      `UPDATE evictions SET
       status = COALESCE(?, status),
       reason = COALESCE(?, reason),
       reason_notes = COALESCE(?, reason_notes),
       notice_served_date = COALESCE(?, notice_served_date),
       filed_date = COALESCE(?, filed_date),
       court_date = COALESCE(?, court_date),
       judgment_date = COALESCE(?, judgment_date),
       vacate_by_date = COALESCE(?, vacate_by_date),
       completed_date = COALESCE(?, completed_date),
       lawyer_name = COALESCE(?, lawyer_name),
       lawyer_phone = COALESCE(?, lawyer_phone),
       case_number = COALESCE(?, case_number),
       court_name = COALESCE(?, court_name),
       judgment_result = COALESCE(?, judgment_result),
       notes = COALESCE(?, notes),
       updated_at = ?
       WHERE id = ?`
    )
      .bind(
        body.status ?? null,
        body.reason ?? null,
        body.reasonNotes ?? null,
        body.noticeServedDate ?? null,
        body.filedDate ?? null,
        body.courtDate ?? null,
        body.judgmentDate ?? null,
        body.vacateByDate ?? null,
        body.completedDate ?? null,
        body.lawyerName ?? null,
        body.lawyerPhone ?? null,
        body.caseNumber ?? null,
        body.courtName ?? null,
        body.judgmentResult ?? null,
        body.notes ?? null,
        now,
        id,
      )
      .run();

    return jsonOk({ success: true });
  } catch {
    return serverError();
  }
};

export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'evictions_manage');
  if (auth instanceof Response) return auth;

  try {
    const id = params.id as string;
    const existing = await env.DB.prepare('SELECT id FROM evictions WHERE id = ?').bind(id).first();
    if (!existing) return jsonError('Eviction not found', 404);

    const { results: costRows } = await env.DB.prepare(
      'SELECT id FROM eviction_costs WHERE eviction_id = ?'
    ).bind(id).all();

    const stmts = [
      env.DB.prepare('DELETE FROM eviction_costs WHERE eviction_id = ?').bind(id),
      env.DB.prepare('DELETE FROM evictions WHERE id = ?').bind(id),
    ];
    for (const row of costRows || []) {
      stmts.push(env.DB.prepare('DELETE FROM expenses WHERE id = ?').bind(`evict-${(row as Record<string, unknown>).id}`));
    }
    await env.DB.batch(stmts);

    return jsonOk({ success: true });
  } catch {
    return serverError();
  }
};
