import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../../lib/session';
import { getProspective } from '../../../lib/prospective';
import { leaseEndDate } from '../../leases/index';
import { isUnitAvailable } from '../../../lib/units';

/**
 * POST /api/prospective-tenants/:id/convert — turn an applicant into an active
 * tenant. Creates the tenant and their lease (unit, rent, move-in fee, dates),
 * carries their uploaded documents over to the new tenant, and marks the
 * applicant converted. Body: { unitId, monthlyRent, moveInFee?, moveInFeePaid?,
 * startDate?, endDate? }.
 */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'tenants_create');
  if (auth instanceof Response) return auth;

  try {
    const id = params.id as string;
    const applicant = await getProspective(env, id);
    if (!applicant) return jsonError('Applicant not found', 404);
    if (applicant.status === 'converted') return jsonError('This applicant is already a tenant', 400);

    const body = (await request.json()) as Record<string, unknown>;
    const unitId = typeof body.unitId === 'string' && body.unitId ? body.unitId : '';
    if (!unitId) return jsonError('Please choose a unit', 400);
    const monthlyRent = Number(body.monthlyRent);
    if (!Number.isFinite(monthlyRent) || monthlyRent <= 0) return jsonError('Enter the monthly rent', 400);

    const unit = await env.DB.prepare('SELECT id, property_id FROM units WHERE id = ?')
      .bind(unitId).first<{ id: string; property_id: string | null }>();
    if (!unit) return jsonError('Unit not found', 404);
    if (!(await isUnitAvailable(env, unitId))) return jsonError('That unit is no longer available', 409);

    const moveInFee = Number(body.moveInFee);
    const startDate = typeof body.startDate === 'string' && body.startDate ? body.startDate : null;
    const endDate = typeof body.endDate === 'string' && body.endDate ? body.endDate : null;

    const tenantId = crypto.randomUUID();
    const leaseId = crypto.randomUUID();

    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO tenants (id, first_name, last_name, email, phone, notes)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(tenantId, applicant.first_name, applicant.last_name, applicant.email ?? null, applicant.phone ?? null, applicant.notes ?? null),
      env.DB.prepare(
        `INSERT INTO leases (id, unit_id, property_id, lease_type, start_date, end_date, monthly_rent,
           security_deposit, move_in_fee_paid, status, needs_review, user_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 0, ?)`
      ).bind(
        leaseId, unitId, unit.property_id ?? null,
        body.leaseType === 'month_to_month' ? 'month_to_month' : 'fixed',
        startDate, leaseEndDate(startDate, endDate, body.leaseType),
        monthlyRent, Number.isFinite(moveInFee) ? moveInFee : 0, body.moveInFeePaid === false ? 0 : 1, auth.id
      ),
      env.DB.prepare('INSERT OR IGNORE INTO lease_tenants (id, lease_id, tenant_id) VALUES (?, ?, ?)')
        .bind(crypto.randomUUID(), leaseId, tenantId),
      // Carry only the APPLICANT'S OWN uploads (their signed copies, uploaded_by
      // IS NULL) onto the new tenant. The blank documents the office sent for
      // signing (uploaded_by set, e.g. the lease we sent) are NOT carried over,
      // so the tenant's file has what they signed, not the templates we sent.
      // History is kept either way via the prospective_tenant_id column.
      env.DB.prepare('UPDATE documents SET tenant_id = ? WHERE prospective_tenant_id = ? AND uploaded_by IS NULL').bind(tenantId, id),
      env.DB.prepare(
        `UPDATE prospective_tenants SET status = 'converted', converted_tenant_id = ?, updated_at = unixepoch() WHERE id = ?`
      ).bind(tenantId, id),
    ]);

    return jsonOk({ success: true, data: { tenantId } }, 201);
  } catch {
    return serverError();
  }
};
