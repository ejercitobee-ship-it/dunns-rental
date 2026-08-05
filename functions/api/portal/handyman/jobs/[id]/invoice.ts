import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requireUser, jsonOk, jsonError, serverError } from '../../../../../lib/session';
import { handymanForUser } from '../../../../../lib/portal';
import { loadOwnedJob, serializeJob } from '../../../../../lib/handyman-jobs';
import { logStatusChange } from '../../../../../lib/maintenance';
import { notifyOffice } from '../../../../../lib/maintenance-notify';
import { uploadToDrive, ensurePropertyExpenseCategory, ensureRootFolder, DriveNotConnected } from '../../../../../lib/google';

const MAX_FILE_BYTES = 15 * 1024 * 1024; // 15 MB per file
const MAX_FILES = 10;
const ALLOWED_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

/**
 * POST /api/portal/handyman/jobs/:id/invoice — the handyman uploads their
 * invoice for a job that has been approved for invoicing. Only the handyman
 * assigned to the job can upload. Accepts multipart form data with:
 *
 *   files[]          — one or more invoice/receipt files (PDF, JPG, PNG)
 *   invoiceNumber    — the handyman's own invoice number
 *   invoiceDate      — YYYY-MM-DD
 *   laborAmount      — numeric
 *   materialAmount   — numeric
 *   totalAmount      — numeric (must equal labor + material)
 *   notes            — optional text
 *
 * Transitions the request from `approved_for_invoicing` (or re-submit after
 * revision) to `invoice_submitted`.
 */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requireUser(env, request);
  if (auth instanceof Response) return auth;
  if (auth.role !== 'handyman') return jsonError('Not a handyman account', 403);

  try {
    const handyman = await handymanForUser(env, auth.id);
    if (!handyman) return jsonError('No active handyman record is linked to this login', 404);

    const jobId = params.id as string;
    const existing = await loadOwnedJob(env, jobId, handyman.id);
    if (!existing) return jsonError('Job not found', 404);

    // Only allow upload when the status is right.
    const status = existing.status as string;
    if (status !== 'approved_for_invoicing') {
      if (status === 'invoice_submitted') {
        return jsonError('An invoice has already been submitted for this job. Wait for the office to review it.', 409);
      }
      return jsonError('This job is not ready for an invoice yet.', 400);
    }

    // Parse multipart form.
    const form = await request.formData();

    const invoiceNumber = (form.get('invoiceNumber') as string || '').trim();
    const invoiceDate = (form.get('invoiceDate') as string || '').trim().slice(0, 10);
    const laborAmount = Number(form.get('laborAmount'));
    const materialAmount = Number(form.get('materialAmount'));
    const totalAmount = Number(form.get('totalAmount'));
    const notes = (form.get('notes') as string || '').trim() || null;

    if (!invoiceNumber) return jsonError('Enter your invoice number.', 400);
    if (!invoiceDate) return jsonError('Enter the invoice date.', 400);
    if (!Number.isFinite(laborAmount) || laborAmount < 0) return jsonError('Enter a valid labor amount.', 400);
    if (!Number.isFinite(materialAmount) || materialAmount < 0) return jsonError('Enter a valid material amount.', 400);
    if (!Number.isFinite(totalAmount) || totalAmount <= 0) return jsonError('Enter a valid total amount.', 400);

    // Collect uploaded files.
    const files: File[] = [];
    for (const entry of form.getAll('files[]')) {
      if (typeof entry === 'string') continue;
      const f = entry as unknown as File;
      if (typeof f.arrayBuffer !== 'function') continue;
      files.push(f);
    }
    // Also try singular 'file' key as a fallback.
    for (const entry of form.getAll('file')) {
      if (typeof entry === 'string') continue;
      const f = entry as unknown as File;
      if (typeof f.arrayBuffer !== 'function') continue;
      files.push(f);
    }

    if (files.length === 0) return jsonError('Attach at least one invoice file (PDF, JPG, or PNG).', 400);
    if (files.length > MAX_FILES) return jsonError(`You can attach up to ${MAX_FILES} files.`, 400);

    for (const f of files) {
      if (f.size > MAX_FILE_BYTES) return jsonError(`${f.name} is too large (max 15 MB).`, 413);
      if (!ALLOWED_TYPES.has(f.type)) {
        return jsonError(`${f.name}: only PDF, JPG, PNG, and WebP files are accepted.`, 400);
      }
    }

    // Upload each file to Drive, under the property's Expenses > Maintenance > year folder.
    const propertyId = existing.property_id as string | null;
    const year = parseInt(invoiceDate.slice(0, 4), 10) || new Date().getFullYear();
    let folderId: string;
    try {
      if (propertyId) {
        folderId = (await ensurePropertyExpenseCategory(env, propertyId, 'Maintenance', year)) ?? await ensureRootFolder(env);
      } else {
        folderId = await ensureRootFolder(env);
      }
    } catch (err) {
      if (err instanceof DriveNotConnected) {
        return jsonError('Google Drive is not connected. Ask the office to connect it in Settings.', 503);
      }
      throw err;
    }

    const driveEntries: { id: string; name: string; contentType: string }[] = [];
    for (const f of files) {
      const label = `Invoice ${invoiceNumber} - ${f.name}`;
      const uploaded = await uploadToDrive(env, folderId, label, f.type || 'application/octet-stream', f);
      driveEntries.push({ id: uploaded.id, name: f.name, contentType: f.type });
    }

    const today = new Date().toISOString().slice(0, 10);
    const stmts = [
      env.DB.prepare(
        `UPDATE maintenance_requests
            SET invoice_number = ?, invoice_date = ?, invoice_labor_amount = ?,
                invoice_material_amount = ?, invoice_total_amount = ?, invoice_notes = ?,
                invoice_drive_ids = ?, invoice_submitted_at = ?,
                invoice_rejection_reason = NULL,
                status = 'invoice_submitted', updated_at = unixepoch()
          WHERE id = ? AND assigned_handyman_id = ?`
      ).bind(
        invoiceNumber, invoiceDate, laborAmount, materialAmount, totalAmount, notes,
        JSON.stringify(driveEntries), today,
        jobId, handyman.id
      ),
      logStatusChange(env.DB, jobId, 'approved_for_invoicing', 'invoice_submitted', auth.id, auth.name, `Invoice #${invoiceNumber}`),
    ];
    await env.DB.batch(stmts);

    // Notify the office.
    const hName = auth.name || 'A handyman';
    context.waitUntil(
      notifyOffice(env, `Invoice submitted: ${existing.title as string}`, [
        ['Handyman', hName],
        ['Invoice #', invoiceNumber],
        ['Total', `$${totalAmount.toFixed(2)}`],
        ['Next', 'Review and approve the invoice on the Maintenance page.'],
      ]).catch(e => console.error('invoice notify office failed', e))
    );

    const row = await loadOwnedJob(env, jobId, handyman.id);
    return jsonOk({ success: true, data: row ? serializeJob(row) : null });
  } catch (err) {
    if (err instanceof DriveNotConnected) {
      return jsonError('Google Drive is not connected. Ask the office to connect it in Settings.', 503);
    }
    return serverError();
  }
};
