import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../../lib/session';
import { serializeExpense } from '../../../lib/serializers';
import { ensurePropertyExpenseCategory, ensureManagementExpensesFolder, ensureRootFolder, uploadToDrive, DriveNotConnected } from '../../../lib/google';
import { logStatusChange } from '../../../lib/maintenance';

const MAX_BYTES = 15 * 1024 * 1024; // 15 MB
const MAINT_PREFIX = 'maint-';

/**
 * POST /api/expenses/:id/receipt — upload a receipt image for an expense. The
 * file is stored in the Drive folder of the unit the expense belongs to (or the
 * root when the expense has no unit); its Drive id is saved on the expense.
 *
 * When the expense belongs to a maintenance request (id starts with "maint-"),
 * the receipt is also recorded on the maintenance request as its invoice, the
 * status is advanced to "paid" if it wasn't already, and a history entry is
 * written. This keeps Expenses and Maintenance in sync when the invoice is
 * uploaded on the finance side rather than through the handyman portal.
 */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'finances_expenses');
  if (auth instanceof Response) return auth;

  try {
    const id = params.id as string;
    const expense = await env.DB.prepare('SELECT id, unit_id, property_id, category, date, description, amount FROM expenses WHERE id = ?')
      .bind(id).first<{ id: string; unit_id: string | null; property_id: string | null; category: string | null; date: string | null; description: string | null; amount: number }>();
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

    // ── Maintenance sync ──────────────────────────────────────────────
    // If this expense was created by the "Mark paid" flow on a maintenance
    // request (id = maint-<requestId>), sync the uploaded invoice back to
    // the maintenance request so the Work Order Details page shows it and
    // the status reflects that everything is complete.
    if (id.startsWith(MAINT_PREFIX)) {
      const requestId = id.slice(MAINT_PREFIX.length);
      const maint = await env.DB.prepare('SELECT status FROM maintenance_requests WHERE id = ?')
        .bind(requestId)
        .first<{ status: string }>();
      if (maint) {
        const today = new Date().toISOString().slice(0, 10);
        const stmts = [
          // Store the Drive file ID as the invoice attachment and record
          // who uploaded it so the Work Order Details modal shows it.
          env.DB.prepare(
            `UPDATE maintenance_requests
                SET invoice_drive_ids = ?,
                    invoice_approved_by = ?,
                    invoice_approved_at = COALESCE(invoice_approved_at, ?),
                    paid_at = COALESCE(paid_at, ?),
                    cost = COALESCE(NULLIF(cost, 0), ?),
                    updated_at = unixepoch()
              WHERE id = ?`
          ).bind(
            JSON.stringify([{ id: uploaded.id, name: file.name, contentType: file.type || 'application/octet-stream' }]),
            auth.name ?? auth.id,
            today,
            today,
            expense.amount,
            requestId,
          ),
        ];

        // If the maintenance request is still in an intermediate status
        // (awaiting invoice, invoice submitted, etc.), move it to paid.
        const PRE_PAID = new Set([
          'approved_for_invoicing', 'invoice_submitted', 'invoice_approved',
          'completed', 'in_progress',
        ]);
        if (PRE_PAID.has(maint.status)) {
          stmts.push(
            env.DB.prepare(
              `UPDATE maintenance_requests SET status = 'paid' WHERE id = ?`
            ).bind(requestId),
          );
          stmts.push(
            logStatusChange(env.DB, requestId, maint.status, 'paid', auth.id, auth.name,
              `Invoice uploaded on Expenses page, marked paid`),
          );
        }

        await env.DB.batch(stmts);
      }
    }

    const row = await env.DB.prepare('SELECT * FROM expenses WHERE id = ?').bind(id).first();
    return jsonOk({ success: true, data: serializeExpense(row as Record<string, unknown>) });
  } catch (err) {
    if (err instanceof DriveNotConnected) {
      return jsonError('Google Drive is not connected. Connect it in Settings.', 503);
    }
    return serverError();
  }
};
