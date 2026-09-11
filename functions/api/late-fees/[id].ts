import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../lib/session';
import { serializeLateFee } from '../../lib/serializers';
import { logActivityStmt } from '../../lib/activity';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

/**
 * GET /api/late-fees/:id
 */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'rents_view');
  if (auth instanceof Response) return auth;

  try {
    const row = await env.DB.prepare('SELECT * FROM late_fees WHERE id = ?')
      .bind(params.id as string).first();
    if (!row) return jsonError('Late fee not found', 404);
    return jsonOk({ success: true, data: serializeLateFee(row as Record<string, unknown>) });
  } catch {
    return serverError();
  }
};

/**
 * PUT /api/late-fees/:id — update amount or notes on an outstanding late fee.
 */
export const onRequestPut: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'rents_edit');
  if (auth instanceof Response) return auth;

  try {
    const id = params.id as string;
    const before = await env.DB.prepare('SELECT * FROM late_fees WHERE id = ?')
      .bind(id).first<Record<string, unknown>>();
    if (!before) return jsonError('Late fee not found', 404);

    const body = (await request.json()) as Record<string, unknown>;

    // Handle waive action.
    if (body.action === 'waive') {
      if (before.status === 'waived') return jsonError('Already waived', 400);
      const reason = (body.waiveReason as string) || '';
      await env.DB.batch([
        env.DB.prepare(
          `UPDATE late_fees SET status = 'waived', waived_at = unixepoch(), waived_by = ?, waive_reason = ? WHERE id = ?`
        ).bind(auth.id, reason || null, id),
        logActivityStmt(env.DB, auth, {
          module: 'finances',
          action: 'Waived a late fee',
          targetType: 'late_fee',
          targetId: id,
          description: `Waived $${before.amount} late fee for ${MONTHS[(before.month as number) - 1]} ${before.year}${reason ? `: ${reason}` : ''}`,
          previousValues: { status: before.status },
          newValues: { status: 'waived', waiveReason: reason },
        }),
      ]);
      const row = await env.DB.prepare('SELECT * FROM late_fees WHERE id = ?').bind(id).first();
      return jsonOk({ success: true, data: serializeLateFee(row as Record<string, unknown>) });
    }

    // Regular update (amount, notes, assessedDate).
    if (before.status === 'waived' || before.status === 'paid') {
      return jsonError('Cannot edit a waived or fully paid late fee', 400);
    }

    const amount = body.amount !== undefined ? Number(body.amount) : before.amount;
    if (!Number.isFinite(amount as number) || (amount as number) <= 0) {
      return jsonError('Amount must be a positive number', 400);
    }

    await env.DB.batch([
      env.DB.prepare(
        `UPDATE late_fees SET amount = ?, notes = ?, assessed_date = COALESCE(?, assessed_date) WHERE id = ?`
      ).bind(
        amount,
        body.notes !== undefined ? (body.notes as string) || null : before.notes,
        body.assessedDate ?? null,
        id
      ),
      logActivityStmt(env.DB, auth, {
        module: 'finances',
        action: 'Updated a late fee',
        targetType: 'late_fee',
        targetId: id,
        description: `Updated late fee for ${MONTHS[(before.month as number) - 1]} ${before.year}`,
        previousValues: { amount: before.amount, notes: before.notes },
        newValues: { amount, notes: body.notes },
      }),
    ]);

    const row = await env.DB.prepare('SELECT * FROM late_fees WHERE id = ?').bind(id).first();
    return jsonOk({ success: true, data: serializeLateFee(row as Record<string, unknown>) });
  } catch {
    return serverError();
  }
};

/**
 * DELETE /api/late-fees/:id — remove a late fee (only if outstanding or waived).
 */
export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'rents_edit');
  if (auth instanceof Response) return auth;

  try {
    const id = params.id as string;
    const before = await env.DB.prepare('SELECT * FROM late_fees WHERE id = ?')
      .bind(id).first<Record<string, unknown>>();
    if (!before) return jsonError('Late fee not found', 404);
    if (before.status === 'paid') {
      return jsonError('Cannot delete a paid late fee', 400);
    }

    await env.DB.batch([
      env.DB.prepare('DELETE FROM late_fees WHERE id = ?').bind(id),
      logActivityStmt(env.DB, auth, {
        module: 'finances',
        action: 'Deleted a late fee',
        targetType: 'late_fee',
        targetId: id,
        description: `Deleted $${before.amount} late fee for ${MONTHS[(before.month as number) - 1]} ${before.year}`,
      }),
    ]);
    return jsonOk({ success: true });
  } catch {
    return serverError();
  }
};
