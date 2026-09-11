import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../lib/session';
import { serializeLateFee } from '../../lib/serializers';
import { logActivityStmt } from '../../lib/activity';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

/**
 * GET /api/late-fees — list all late fees, optionally filtered by lease.
 */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requirePermission(env, request, 'rents_view');
  if (auth instanceof Response) return auth;

  try {
    const url = new URL(request.url);
    const leaseId = url.searchParams.get('leaseId');

    let query = 'SELECT * FROM late_fees';
    const binds: unknown[] = [];
    if (leaseId) {
      query += ' WHERE lease_id = ?';
      binds.push(leaseId);
    }
    query += ' ORDER BY year DESC, month DESC, created_at DESC';

    const stmt = binds.length
      ? env.DB.prepare(query).bind(...binds)
      : env.DB.prepare(query);
    const { results } = await stmt.all();
    return jsonOk({ success: true, data: (results || []).map(serializeLateFee) });
  } catch {
    return serverError();
  }
};

/**
 * POST /api/late-fees — manually assess a late fee.
 *
 * Body: { leaseId, month, year, amount, assessedDate, tenantId?, notes? }
 */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requirePermission(env, request, 'rents_record');
  if (auth instanceof Response) return auth;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    if (!body.leaseId) return jsonError('Lease is required', 400);
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return jsonError('Amount must be a positive number', 400);
    }
    const month = Number(body.month);
    const year = Number(body.year);
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      return jsonError('Month must be between 1 and 12', 400);
    }
    if (!Number.isInteger(year) || year < 2000) {
      return jsonError('Year is required', 400);
    }
    if (!body.assessedDate) return jsonError('Assessed date is required', 400);

    // Check for duplicate: one late fee per lease per period.
    const existing = await env.DB.prepare(
      'SELECT id FROM late_fees WHERE lease_id = ? AND month = ? AND year = ?'
    ).bind(body.leaseId, month, year).first();
    if (existing) {
      return jsonError(`A late fee already exists for ${MONTHS[month - 1]} ${year}`, 409);
    }

    // Resolve property/unit from the lease.
    const lease = await env.DB.prepare(
      'SELECT property_id, unit_id FROM leases WHERE id = ?'
    ).bind(body.leaseId).first<{ property_id: string | null; unit_id: string | null }>();

    const id = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO late_fees (id, lease_id, tenant_id, property_id, unit_id, month, year, amount, assessed_date, status, notes, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'outstanding', ?, ?)`
      ).bind(
        id,
        body.leaseId,
        body.tenantId ?? null,
        lease?.property_id ?? null,
        lease?.unit_id ?? null,
        month,
        year,
        amount,
        body.assessedDate,
        (body.notes as string) || null,
        auth.id
      ),
      logActivityStmt(env.DB, auth, {
        module: 'finances',
        action: 'Assessed a late fee',
        targetType: 'late_fee',
        targetId: id,
        description: `$${amount} late fee for ${MONTHS[month - 1]} ${year}`,
        newValues: { amount, month, year, leaseId: body.leaseId },
      }),
    ]);

    const row = await env.DB.prepare('SELECT * FROM late_fees WHERE id = ?').bind(id).first();
    return jsonOk({ success: true, data: serializeLateFee(row as Record<string, unknown>) }, 201);
  } catch {
    return serverError();
  }
};
