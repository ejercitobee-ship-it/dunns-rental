import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requireSuperAdmin, jsonOk, jsonError, serverError } from '../../../../lib/session';
import { logActivityStmt } from '../../../../lib/activity';

/**
 * PUT /api/tenants/:id/credits/:creditId — super admin edits a credit entry.
 *
 * Body: { amount?: number, reason?: string, notes?: string }
 */
export const onRequestPut: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requireSuperAdmin(env, request);
  if (auth instanceof Response) return auth;

  try {
    const tenantId = params.id as string;
    const creditId = params.creditId as string;
    const body = (await request.json()) as Record<string, unknown>;

    const existing = await env.DB.prepare(
      'SELECT * FROM tenant_credits WHERE id = ? AND tenant_id = ?'
    ).bind(creditId, tenantId).first<{ amount: number; reason: string | null; notes: string | null }>();
    if (!existing) return jsonError('Credit entry not found', 404);

    const amount = body.amount !== undefined ? Number(body.amount) : existing.amount;
    if (Number.isNaN(amount) || amount === 0) {
      return jsonError('Amount must be a non-zero number.', 400);
    }
    const reason = body.reason !== undefined ? ((body.reason as string) || null) : existing.reason;
    const notes = body.notes !== undefined ? (((body.notes as string) || '').trim() || null) : existing.notes;

    await env.DB.batch([
      env.DB.prepare(
        `UPDATE tenant_credits SET amount = ?, reason = ?, notes = ? WHERE id = ?`
      ).bind(amount, reason, notes, creditId),
      logActivityStmt(env.DB, auth, {
        module: 'tenants',
        action: 'Edited tenant credit',
        targetType: 'tenants',
        targetId: tenantId,
        description: `Credit ${creditId}: $${existing.amount} → $${amount}`,
        previousValues: { amount: existing.amount, reason: existing.reason, notes: existing.notes },
        newValues: { amount, reason, notes },
      }),
    ]);

    const bal = await env.DB.prepare(
      `SELECT COALESCE(SUM(amount), 0) AS balance FROM tenant_credits WHERE tenant_id = ?`
    ).bind(tenantId).first<{ balance: number }>();

    return jsonOk({
      success: true,
      balance: Math.round((bal?.balance ?? 0) * 100) / 100,
    });
  } catch {
    return serverError();
  }
};

/**
 * DELETE /api/tenants/:id/credits/:creditId — super admin deletes a credit entry.
 */
export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requireSuperAdmin(env, request);
  if (auth instanceof Response) return auth;

  try {
    const tenantId = params.id as string;
    const creditId = params.creditId as string;

    const existing = await env.DB.prepare(
      'SELECT amount, reason FROM tenant_credits WHERE id = ? AND tenant_id = ?'
    ).bind(creditId, tenantId).first<{ amount: number; reason: string | null }>();
    if (!existing) return jsonError('Credit entry not found', 404);

    await env.DB.batch([
      env.DB.prepare('DELETE FROM tenant_credits WHERE id = ?').bind(creditId),
      logActivityStmt(env.DB, auth, {
        module: 'tenants',
        action: 'Deleted tenant credit',
        targetType: 'tenants',
        targetId: tenantId,
        description: `Removed $${Math.abs(existing.amount)} credit${existing.reason ? ` (${existing.reason})` : ''}`,
      }),
    ]);

    const bal = await env.DB.prepare(
      `SELECT COALESCE(SUM(amount), 0) AS balance FROM tenant_credits WHERE tenant_id = ?`
    ).bind(tenantId).first<{ balance: number }>();

    return jsonOk({
      success: true,
      balance: Math.round((bal?.balance ?? 0) * 100) / 100,
    });
  } catch {
    return serverError();
  }
};
