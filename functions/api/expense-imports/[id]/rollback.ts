import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requireSuperAdmin, jsonOk, jsonError, serverError } from '../../../lib/session';

/**
 * POST /api/expense-imports/:id/rollback — remove all live expenses that
 * were created by this import. Only manually entered expenses are left alone.
 */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requireSuperAdmin(env, request);
  if (auth instanceof Response) return auth;

  try {
    const importId = params.id as string;
    const imp = await env.DB.prepare(
      'SELECT * FROM expense_imports WHERE id = ?'
    ).bind(importId).first<Record<string, unknown>>();
    if (!imp) return jsonError('Import not found', 404);
    if (imp.status !== 'merged') return jsonError('Only merged imports can be rolled back.', 400);

    // Count how many expenses will be removed
    const count = await env.DB.prepare(
      `SELECT COUNT(*) as cnt FROM expenses WHERE import_id = ?`
    ).bind(importId).first<{ cnt: number }>();

    // Delete imported expenses and update import status
    await env.DB.batch([
      env.DB.prepare('DELETE FROM expenses WHERE import_id = ?').bind(importId),
      env.DB.prepare(
        `UPDATE expense_import_rows SET created_expense_id = NULL WHERE import_id = ?`
      ).bind(importId),
      env.DB.prepare(
        `UPDATE expense_imports SET status = 'rolled_back', rolled_back_at = unixepoch(), rolled_back_by = ?, rolled_back_by_name = ? WHERE id = ?`
      ).bind(auth.id, auth.name, importId),
    ]);

    return jsonOk({
      success: true,
      data: { removedExpenses: count?.cnt || 0 },
    });
  } catch (err) {
    console.error('Rollback error:', err);
    return serverError();
  }
};
