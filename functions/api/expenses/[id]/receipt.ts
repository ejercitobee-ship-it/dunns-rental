import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../../lib/session';
import { serializeExpense } from '../../../lib/serializers';
import { ensurePropertyExpenseCategory, ensureManagementExpensesFolder, ensureRootFolder, uploadToDrive, DriveNotConnected } from '../../../lib/google';

const MAX_BYTES = 15 * 1024 * 1024; // 15 MB

/**
 * POST /api/expenses/:id/receipt — upload a receipt image for an expense. The
 * file is stored in the Drive folder of the unit the expense belongs to (or the
 * root when the expense has no unit); its Drive id is saved on the expense.
 */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'finances_expenses');
  if (auth instanceof Response) return auth;

  try {
    const id = params.id as string;
    const expense = await env.DB.prepare('SELECT id, unit_id, property_id, category, date, description FROM expenses WHERE id = ?')
      .bind(id).first<{ id: string; unit_id: string | null; property_id: string | null; category: string | null; date: string | null; description: string | null }>();
    if (!expense) return jsonError('Expense not found', 404);

    const form = await request.formData();
    const file = form.get('file') as unknown as File | null;
    if (!file || typeof file.arrayBuffer !== 'function') return jsonError('No file provided', 400);
    if (file.size > MAX_BYTES) return jsonError('File is too large (max 15 MB)', 413);

    const MGMT_CATEGORIES = new Set(['management', 'other']);
    const expenseYear = expense.date ? parseInt(expense.date.slice(0, 4), 10) : new Date().getFullYear();
    const isManagement = !expense.property_id && MGMT_CATEGORIES.has(expense.category ?? '');
    const categoryLabel = (expense.category ?? 'Other').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

    let folderId: string;
    if (isManagement) {
      folderId = await ensureManagementExpensesFolder(env, expenseYear);
    } else if (expense.property_id && expense.category) {
      folderId = (await ensurePropertyExpenseCategory(env, expense.property_id, categoryLabel, expenseYear)) ?? await ensureRootFolder(env);
    } else {
      folderId = await ensureRootFolder(env);
    }
    const label = `Receipt - ${(expense.description || 'Expense').slice(0, 40)} - ${file.name}`;
    const uploaded = await uploadToDrive(env, folderId, label, file.type || 'application/octet-stream', file);

    await env.DB.prepare('UPDATE expenses SET receipt_drive_id = ?, updated_at = unixepoch() WHERE id = ?')
      .bind(uploaded.id, id).run();

    const row = await env.DB.prepare('SELECT * FROM expenses WHERE id = ?').bind(id).first();
    return jsonOk({ success: true, data: serializeExpense(row as Record<string, unknown>) });
  } catch (err) {
    if (err instanceof DriveNotConnected) {
      return jsonError('Google Drive is not connected. Connect it in Settings.', 503);
    }
    return serverError();
  }
};
