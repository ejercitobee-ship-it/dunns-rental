import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../../lib/session';
import { logActivityStmt } from '../../../lib/activity';

interface CreditRow {
  id: string;
  tenant_id: string;
  amount: number;
  reason: string | null;
  notes: string | null;
  applied_to_payment_id: string | null;
  created_by: string;
  created_at: number;
}

function serialize(r: CreditRow) {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    amount: r.amount,
    reason: r.reason,
    notes: r.notes,
    appliedToPaymentId: r.applied_to_payment_id,
    createdBy: r.created_by,
    createdAt: r.created_at,
  };
}

/**
 * GET /api/tenants/:id/credits — list credit entries + running balance.
 */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'tenants_view');
  if (auth instanceof Response) return auth;

  try {
    const tenantId = params.id as string;
    const [entries, balanceRow] = await Promise.all([
      env.DB.prepare(
        `SELECT * FROM tenant_credits WHERE tenant_id = ? ORDER BY created_at DESC`
      ).bind(tenantId).all<CreditRow>(),
      env.DB.prepare(
        `SELECT COALESCE(SUM(amount), 0) AS balance FROM tenant_credits WHERE tenant_id = ?`
      ).bind(tenantId).first<{ balance: number }>(),
    ]);

    return jsonOk({
      balance: Math.round((balanceRow?.balance ?? 0) * 100) / 100,
      entries: (entries.results || []).map(serialize),
    });
  } catch {
    return serverError();
  }
};

/**
 * POST /api/tenants/:id/credits — add a credit (positive amount).
 *
 * Body: { amount: number, reason?: string, notes?: string }
 */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'rents_record');
  if (auth instanceof Response) return auth;

  try {
    const tenantId = params.id as string;
    const body = (await request.json()) as Record<string, unknown>;
    const amount = Number(body.amount);
    if (!body.amount || Number.isNaN(amount) || amount <= 0) {
      return jsonError('Amount must be greater than zero.', 400);
    }

    const tenant = await env.DB.prepare('SELECT name FROM tenants WHERE id = ?')
      .bind(tenantId).first<{ name: string }>();
    if (!tenant) return jsonError('Tenant not found', 404);

    const id = crypto.randomUUID();
    const reason = (body.reason as string) || null;
    const notes = ((body.notes as string) || '').trim() || null;

    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO tenant_credits (id, tenant_id, amount, reason, notes, created_by)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(id, tenantId, amount, reason, notes, auth.id),
      logActivityStmt(env.DB, auth, {
        module: 'tenants',
        action: 'Added tenant credit',
        targetType: 'tenants',
        targetId: tenantId,
        description: `$${amount} credit for ${tenant.name}${reason ? ` (${reason})` : ''}`,
        newValues: { amount, reason, notes },
      }),
    ]);

    // Return the updated balance.
    const bal = await env.DB.prepare(
      `SELECT COALESCE(SUM(amount), 0) AS balance FROM tenant_credits WHERE tenant_id = ?`
    ).bind(tenantId).first<{ balance: number }>();

    return jsonOk({
      id,
      balance: Math.round((bal?.balance ?? 0) * 100) / 100,
    });
  } catch {
    return serverError();
  }
};
