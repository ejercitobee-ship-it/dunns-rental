import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, serverError } from '../../lib/session';

function serialize(r: Record<string, unknown>) {
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
    createdBy: r.created_by ?? null,
    createdAt: r.created_at,
    submittedAt: r.submitted_at ?? null,
    updatedAt: r.updated_at,
    // Joined fields.
    jobTitle: r.job_title ?? null,
    propName: r.prop_name ?? null,
    propAddress: r.prop_address ?? null,
    unitNumber: r.unit_number ?? null,
  };
}

/** GET /api/vendor-submissions — list all vendor submissions for the admin. */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requirePermission(env, request, 'maintenance_approve');
  if (auth instanceof Response) return auth;

  try {
    const { results } = await env.DB.prepare(
      `SELECT vs.*,
              m.title AS job_title,
              p.name AS prop_name, p.address AS prop_address,
              u.unit_number
         FROM vendor_submissions vs
         LEFT JOIN maintenance_requests m ON m.id = vs.maintenance_request_id
         LEFT JOIN properties p ON p.id = vs.property_id
         LEFT JOIN units u ON u.id = vs.unit_id
        ORDER BY vs.created_at DESC`
    ).all();

    return jsonOk({ success: true, data: (results || []).map(r => serialize(r as Record<string, unknown>)) });
  } catch {
    return serverError();
  }
};
