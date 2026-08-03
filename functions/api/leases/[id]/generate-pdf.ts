import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../../lib/session';
import { generateAndSaveLease, type LeaseTerms } from '../../../lib/lease-pdf';
import { DriveNotConnected } from '../../../lib/google';
import { sendEmail } from '../../../lib/email';

/**
 * POST /api/leases/:id/generate-pdf — generate a lease agreement PDF from the
 * lease record + form terms, save it to the tenant's "Lease" subfolder in Drive,
 * optionally save as a document record and email to the tenant.
 */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'tenants_edit');
  if (auth instanceof Response) return auth;

  try {
    const leaseId = params.id as string;
    const lease = await env.DB.prepare(
      `SELECT l.*, p.address AS prop_address, p.name AS prop_name, u.unit_number
       FROM leases l
       LEFT JOIN properties p ON p.id = l.property_id
       LEFT JOIN units u ON u.id = l.unit_id
       WHERE l.id = ?`
    ).bind(leaseId).first();
    if (!lease) return jsonError('Lease not found', 404);

    const tenants = await env.DB.prepare(
      `SELECT t.id, t.first_name, t.last_name, t.email
       FROM tenants t JOIN lease_tenants lt ON lt.tenant_id = t.id
       WHERE lt.lease_id = ?`
    ).bind(leaseId).all<{ id: string; first_name: string; last_name: string; email: string | null }>();

    if (!tenants.results?.length) return jsonError('No tenants on this lease', 400);
    const primaryTenant = tenants.results[0];
    const tenantNames = tenants.results.map(t => `${t.first_name} ${t.last_name}`).join(' and ');

    const body = (await request.json()) as Partial<LeaseTerms> & { emailToTenant?: boolean };

    const location = lease.prop_address || lease.prop_name || '';

    const terms: LeaseTerms = {
      tenantNames,
      propertyAddress: location as string,
      unitNumber: (lease.unit_number as string) || undefined,
      startDate: body.startDate || (lease.start_date as string) || '',
      endDate: body.endDate || (lease.end_date as string) || '',
      monthlyRent: body.monthlyRent ?? (Number(lease.rent_amount) || 0),
      securityDeposit: body.securityDeposit ?? 0,
      lateFeeAmount: body.lateFeeAmount ?? 50,
      lateFeeGraceDays: body.lateFeeGraceDays ?? 5,
      rentDueDay: body.rentDueDay ?? (Number(lease.rent_due_day) || 1),
      utilities: body.utilities || 'Tenant is responsible for all utilities.',
      petPolicy: body.petPolicy || 'No pets allowed without prior written consent.',
      additionalTerms: body.additionalTerms || undefined,
    };

    const result = await generateAndSaveLease(env, primaryTenant.id, terms);

    const docId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO documents (id, name, drive_file_id, content_type, size, property_id, tenant_id, uploaded_by)
       VALUES (?, ?, ?, 'application/pdf', 0, ?, ?, ?)`
    ).bind(docId, result.fileName, result.driveId, lease.property_id, primaryTenant.id, auth.id).run();

    if (body.emailToTenant && primaryTenant.email) {
      context.waitUntil(
        sendEmail(env, {
          to: primaryTenant.email,
          subject: `Your Lease Agreement is Ready`,
          text: `Hi ${primaryTenant.first_name},\n\nYour lease agreement has been generated and is available in your tenant portal under Documents.\n\nPlease review it at your earliest convenience.\n\nThank you.`,
          html: `<p>Hi ${primaryTenant.first_name},</p><p>Your lease agreement has been generated and is available in your tenant portal under Documents.</p><p>Please review it at your earliest convenience.</p><p>Thank you.</p>`,
        }).catch(e => console.error('lease email failed', e))
      );
    }

    return jsonOk({ success: true, data: { documentId: docId, driveId: result.driveId, fileName: result.fileName } });
  } catch (err) {
    if (err instanceof DriveNotConnected) return jsonError('Google Drive is not connected. Connect it in Settings.', 503);
    return serverError();
  }
};
