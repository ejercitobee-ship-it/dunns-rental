import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requireUser, jsonError } from '../../../lib/session';
import { tenantIdForUser } from '../../../lib/portal';
import { companySettings } from '../../../lib/receipts';
import { buildPaymentPlanPdf, type PlanInstallment } from '../../../lib/payment-plan-pdf';
import { roleCan } from '../../../lib/permissions';

/** GET /api/payment-plans/:id/generate-pdf — download the payment plan agreement as PDF.
 *  Admin users with rents_view can download any plan.
 *  Tenant users can download their own plan. */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requireUser(env, request);
  if (auth instanceof Response) return auth;

  const id = params.id as string;
  const isAdmin = auth.role === 'super_admin' ||
    (auth.permissions ? auth.permissions.includes('rents_view') : roleCan(auth.role, 'rents_view'));

  try {
    const plan = await env.DB.prepare(
      `SELECT pp.*, t.first_name, t.last_name,
              p.address AS property_address,
              u2.unit_number
         FROM payment_plans pp
         LEFT JOIN tenants t ON t.id = pp.tenant_id
         LEFT JOIN leases l ON l.id = pp.lease_id
         LEFT JOIN properties p ON p.id = l.property_id
         LEFT JOIN units u2 ON u2.id = l.unit_id
        WHERE pp.id = ?`
    ).bind(id).first<Record<string, any>>();

    if (!plan) return jsonError('Payment plan not found', 404);

    if (!isAdmin) {
      if (auth.role !== 'tenant') return jsonError('You do not have permission to do that', 403);
      const tenantId = await tenantIdForUser(env, auth.id);
      if (!tenantId || tenantId !== plan.tenant_id) {
        return jsonError('You do not have permission to do that', 403);
      }
    }

    const { results: installments } = await env.DB.prepare(
      `SELECT * FROM payment_plan_installments WHERE plan_id = ? ORDER BY installment_number`
    ).bind(id).all<Record<string, any>>();

    const co = await companySettings(env);
    const tenantName = [plan.first_name, plan.last_name].filter(Boolean).join(' ') || 'Tenant';
    const companyAddr = [co.address, co.city, co.state, co.zipCode].filter(Boolean).join(', ');

    const pdfBytes = await buildPaymentPlanPdf({
      planId: plan.id,
      tenantName,
      propertyAddress: plan.property_address || '',
      unitNumber: plan.unit_number || undefined,
      totalAmount: plan.total_amount,
      reason: plan.reason || undefined,
      startDate: plan.start_date,
      installments: (installments || []).map((i): PlanInstallment => ({
        number: i.installment_number as number,
        dueDate: i.due_date as string,
        amount: i.amount as number,
        status: i.status as string,
      })),
      companyName: co.companyName,
      companyAddress: companyAddr || undefined,
      companyPhone: co.phone || undefined,
    });

    const filename = `payment-plan-${tenantName.replace(/\s+/g, '-').toLowerCase()}.pdf`;

    return new Response(pdfBytes, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (err: any) {
    console.error('payment-plan PDF error:', err);
    return jsonError(err?.message || 'PDF generation failed', 500);
  }
};
