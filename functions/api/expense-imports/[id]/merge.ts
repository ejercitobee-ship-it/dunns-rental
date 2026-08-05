import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requireSuperAdmin, jsonOk, jsonError, serverError } from '../../../lib/session';

/**
 * POST /api/expense-imports/:id/merge — merge all valid/non-skipped rows
 * from the staging table into the live expenses table.
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
    if (imp.status === 'merged') return jsonError('This import has already been merged.', 400);
    if (imp.status === 'rolled_back') return jsonError('This import was rolled back. Upload again to re-import.', 400);

    // Check that there are no unresolved errors (allow duplicates to be skipped)
    const errorCount = await env.DB.prepare(
      `SELECT COUNT(*) as cnt FROM expense_import_rows WHERE import_id = ? AND status = 'error'`
    ).bind(importId).first<{ cnt: number }>();
    if (errorCount && errorCount.cnt > 0) {
      return jsonError(
        `${errorCount.cnt} record(s) still have errors. Fix or skip them before merging.`,
        400,
      );
    }

    // Get all valid rows
    const { results: rows } = await env.DB.prepare(
      `SELECT * FROM expense_import_rows WHERE import_id = ? AND status = 'valid' ORDER BY row_number`
    ).bind(importId).all();

    if (!rows || rows.length === 0) {
      return jsonError('No valid records to merge.', 400);
    }

    const stmts: ReturnType<typeof env.DB.prepare>[] = [];
    let mergedCount = 0;

    for (const row of rows) {
      const expenseId = crypto.randomUUID();

      stmts.push(
        env.DB.prepare(
          `INSERT INTO expenses (id, property_id, unit_id, category, amount, date, description, vendor,
             is_recurring, recurring_frequency, interest_amount, user_id, import_id, import_row_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          expenseId,
          row.property_id ?? null,
          row.unit_id ?? null,
          row.category,
          row.amount,
          row.date,
          row.description,
          row.vendor ?? null,
          row.is_recurring ?? 0,
          row.recurring_frequency ?? null,
          row.interest_amount ?? null,
          auth.id,
          importId,
          row.id,
        )
      );

      // Link the staged row back to the created expense
      stmts.push(
        env.DB.prepare(
          `UPDATE expense_import_rows SET created_expense_id = ? WHERE id = ?`
        ).bind(expenseId, row.id as string)
      );

      mergedCount++;
    }

    // Update import status
    stmts.push(
      env.DB.prepare(
        `UPDATE expense_imports SET status = 'merged', merged_rows = ?, merged_at = unixepoch(), merged_by = ?, merged_by_name = ? WHERE id = ?`
      ).bind(mergedCount, auth.id, auth.name, importId)
    );

    await env.DB.batch(stmts);

    return jsonOk({
      success: true,
      data: { mergedRows: mergedCount },
    });
  } catch (err) {
    console.error('Merge error:', err);
    return serverError();
  }
};
