import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../../lib/session';
import { sendEmail, vendorSubmissionStatusEmail } from '../../../lib/email';

/**
 * POST /api/vendor-submissions/:id/status — admin changes a submission's
 * status: approve, mark paid, or reject.
 *
 * Body: { action: 'approve' | 'paid' | 'reject', notes?: string, rejectionReason?: string }
 *
 * On "approve": writes an expense row and emails the vendor.
 * On "paid": sets paid_at and emails the vendor.
 * On "reject": sets rejectionReason, resets to draft so the vendor can resubmit.
 */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'maintenance_approve');
  if (auth instanceof Response) return auth;

  try {
    const id = params.id as string;
    const body = (await request.json()) as Record<string, unknown>;
    const action = body.action as string;

    if (!['approve', 'paid', 'reject'].includes(action)) {
      return jsonError('Invalid action. Must be approve, paid, or reject.', 400);
    }

    const sub = await env.DB.prepare(
      `SELECT vs.*, m.title AS job_title
         FROM vendor_submissions vs
         LEFT JOIN maintenance_requests m ON m.id = vs.maintenance_request_id
        WHERE vs.id = ?`
    ).bind(id).first<Record<string, unknown>>();
    if (!sub) return jsonError('Submission not found', 404);

    const today = new Date().toISOString().slice(0, 10);

    if (action === 'approve') {
      if (sub.status !== 'submitted') return jsonError('Can only approve submitted invoices.', 400);
      const amount = sub.amount as number;
      const expenseId = `vendor-sub-${id}`;

      // Create an expense for this vendor submission.
      const stmts = [
        env.DB.prepare(
          `UPDATE vendor_submissions
              SET status = 'approved', approved_by = ?, approved_at = ?,
                  admin_notes = COALESCE(?, admin_notes), expense_id = ?,
                  updated_at = unixepoch()
            WHERE id = ?`
        ).bind(auth.id, today, (body.notes as string) || null, expenseId, id),
        env.DB.prepare(
          `INSERT INTO expenses (id, property_id, unit_id, category, amount, date, description, vendor, is_recurring, user_id)
           VALUES (?, ?, ?, 'maintenance', ?, ?, ?, ?, 0, ?)
           ON CONFLICT(id) DO UPDATE SET
             amount = excluded.amount, date = excluded.date, description = excluded.description,
             vendor = excluded.vendor, property_id = excluded.property_id, unit_id = excluded.unit_id,
             updated_at = unixepoch()`
        ).bind(
          expenseId,
          sub.property_id,
          sub.unit_id,
          amount,
          today,
          `Vendor invoice: ${sub.work_description || (sub.job_title as string) || 'Maintenance'}`,
          (sub.company_name as string) || (sub.vendor_name as string) || 'Vendor',
          auth.id
        ),
      ];
      await env.DB.batch(stmts);

      // Email the vendor.
      if (sub.vendor_email) {
        context.waitUntil(
          sendEmail(env, {
            to: sub.vendor_email as string,
            ...vendorSubmissionStatusEmail({
              vendorName: sub.vendor_name as string,
              status: 'approved',
              jobTitle: sub.job_title as string | undefined,
              amount,
            }),
          }).catch(e => console.error('vendor approved email failed', e))
        );
      }
    } else if (action === 'paid') {
      if (sub.status !== 'approved') return jsonError('Can only mark approved invoices as paid.', 400);

      await env.DB.prepare(
        `UPDATE vendor_submissions
            SET status = 'paid', paid_at = ?,
                admin_notes = COALESCE(?, admin_notes),
                updated_at = unixepoch()
          WHERE id = ?`
      ).bind(today, (body.notes as string) || null, id).run();

      if (sub.vendor_email) {
        context.waitUntil(
          sendEmail(env, {
            to: sub.vendor_email as string,
            ...vendorSubmissionStatusEmail({
              vendorName: sub.vendor_name as string,
              status: 'paid',
              jobTitle: sub.job_title as string | undefined,
              amount: sub.amount as number,
            }),
          }).catch(e => console.error('vendor paid email failed', e))
        );
      }
    } else if (action === 'reject') {
      if (sub.status !== 'submitted') return jsonError('Can only reject submitted invoices.', 400);
      const reason = ((body.rejectionReason as string) || '').trim();

      // Reset to draft so the vendor can resubmit via the same link.
      await env.DB.prepare(
        `UPDATE vendor_submissions
            SET status = 'draft', rejection_reason = ?, submitted_at = NULL,
                updated_at = unixepoch()
          WHERE id = ?`
      ).bind(reason || null, id).run();

      if (sub.vendor_email) {
        context.waitUntil(
          sendEmail(env, {
            to: sub.vendor_email as string,
            ...vendorSubmissionStatusEmail({
              vendorName: sub.vendor_name as string,
              status: 'rejected',
              jobTitle: sub.job_title as string | undefined,
              rejectionReason: reason || undefined,
            }),
          }).catch(e => console.error('vendor reject email failed', e))
        );
      }
    }

    // Return the updated record.
    const updated = await env.DB.prepare(
      `SELECT vs.*, m.title AS job_title,
              p.name AS prop_name, p.address AS prop_address,
              u.unit_number
         FROM vendor_submissions vs
         LEFT JOIN maintenance_requests m ON m.id = vs.maintenance_request_id
         LEFT JOIN properties p ON p.id = vs.property_id
         LEFT JOIN units u ON u.id = vs.unit_id
        WHERE vs.id = ?`
    ).bind(id).first<Record<string, unknown>>();

    return jsonOk({ success: true, data: updated ? serializeSub(updated) : null });
  } catch {
    return serverError();
  }
};

function serializeSub(r: Record<string, unknown>) {
  return {
    id: r.id,
    token: r.token,
    maintenanceRequestId: r.maintenance_request_id ?? null,
    vendorName: r.vendor_name || '',
    companyName: r.company_name || '',
    vendorEmail: r.vendor_email || '',
    vendorPhone: r.vendor_phone || '',
    propertyId: r.property_id ?? null,
    unitId: r.unit_id ?? null,
    workDescription: r.work_description || '',
    amount: r.amount ?? null,
    paymentMethod: r.payment_method || '',
    status: r.status,
    approvedBy: r.approved_by ?? null,
    approvedAt: r.approved_at ?? null,
    paidAt: r.paid_at ?? null,
    rejectionReason: r.rejection_reason ?? null,
    adminNotes: r.admin_notes ?? null,
    expenseId: r.expense_id ?? null,
    createdAt: r.created_at,
    submittedAt: r.submitted_at ?? null,
    updatedAt: r.updated_at,
    jobTitle: r.job_title ?? null,
    propName: r.prop_name ?? null,
    propAddress: r.prop_address ?? null,
    unitNumber: r.unit_number ?? null,
  };
}
