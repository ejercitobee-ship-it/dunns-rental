import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../../lib/session';

/** GET /api/expense-imports/:id — full import detail including all rows. */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'finances_import');
  if (auth instanceof Response) return auth;

  try {
    const importId = params.id as string;
    const imp = await env.DB.prepare(
      'SELECT * FROM expense_imports WHERE id = ?'
    ).bind(importId).first();
    if (!imp) return jsonError('Import not found', 404);

    const { results: rows } = await env.DB.prepare(
      'SELECT * FROM expense_import_rows WHERE import_id = ? ORDER BY row_number'
    ).bind(importId).all();

    return jsonOk({
      success: true,
      data: {
        ...serializeImport(imp as Record<string, unknown>),
        rows: (rows || []).map(serializeRow),
      },
    });
  } catch { return serverError(); }
};

/** DELETE /api/expense-imports/:id — discard a staged (un-merged) import. */
export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'finances_import');
  if (auth instanceof Response) return auth;

  try {
    const importId = params.id as string;
    const imp = await env.DB.prepare(
      'SELECT status FROM expense_imports WHERE id = ?'
    ).bind(importId).first<{ status: string }>();
    if (!imp) return jsonError('Import not found', 404);
    if (imp.status === 'merged') return jsonError('Cannot delete a merged import. Use rollback instead.', 400);

    await env.DB.batch([
      env.DB.prepare('DELETE FROM expense_import_rows WHERE import_id = ?').bind(importId),
      env.DB.prepare('DELETE FROM expense_imports WHERE id = ?').bind(importId),
    ]);

    return jsonOk({ success: true });
  } catch { return serverError(); }
};

// ---------------------------------------------------------------------------

function serializeImport(r: Record<string, unknown>) {
  return {
    id: r.id,
    fileName: r.file_name,
    fileDriveId: r.file_drive_id ?? undefined,
    uploadedBy: r.uploaded_by,
    uploadedByName: r.uploaded_by_name,
    uploadedAt: r.uploaded_at,
    status: r.status,
    totalRows: r.total_rows,
    validRows: r.valid_rows,
    errorRows: r.error_rows,
    duplicateRows: r.duplicate_rows,
    mergedRows: r.merged_rows,
    mergedAt: r.merged_at ?? undefined,
    mergedByName: r.merged_by_name ?? undefined,
    rolledBackAt: r.rolled_back_at ?? undefined,
    rolledBackByName: r.rolled_back_by_name ?? undefined,
    notes: r.notes ?? undefined,
  };
}

function serializeRow(r: Record<string, unknown>) {
  let errors: { field: string; message: string }[] = [];
  if (typeof r.errors === 'string') {
    try { errors = JSON.parse(r.errors); } catch { /* ignore */ }
  }
  let originalData: Record<string, string> = {};
  if (typeof r.original_data === 'string') {
    try { originalData = JSON.parse(r.original_data); } catch { /* ignore */ }
  }
  return {
    id: r.id,
    importId: r.import_id,
    rowNumber: r.row_number,
    originalData,
    propertyId: r.property_id ?? undefined,
    propertyName: r.property_name ?? undefined,
    unitId: r.unit_id ?? undefined,
    unitName: r.unit_name ?? undefined,
    category: r.category ?? undefined,
    amount: r.amount ?? undefined,
    date: r.date ?? undefined,
    description: r.description ?? undefined,
    vendor: r.vendor ?? undefined,
    notes: r.notes ?? undefined,
    taxCategory: r.tax_category ?? undefined,
    taxDeductible: r.tax_deductible !== 0,
    isRecurring: !!r.is_recurring,
    recurringFrequency: r.recurring_frequency ?? undefined,
    interestAmount: r.interest_amount ?? undefined,
    status: r.status,
    errors,
    createdExpenseId: r.created_expense_id ?? undefined,
    edited: !!r.edited,
  };
}
