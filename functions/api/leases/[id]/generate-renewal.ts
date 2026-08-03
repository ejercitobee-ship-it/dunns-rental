import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../../lib/session';
import { generateAndSaveRenewal, type RenewalTerms } from '../../../lib/lease-pdf';
import { DriveNotConnected } from '../../../lib/google';
import { sendEmail } from '../../../lib/email';

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

    const body = (await request.json()) as {
      newStartDate: string;
      newEndDate: string;
      newMonthlyRent: number;
      rentDueDay?: number;
      lateFeeAmount?: number;
      lateFeeGraceDays?: number;
      utilities?: string;
      additionalTerms?: string;
      emailToTenant?: boolean;
    };

    if (!body.newStartDate || !body.newEndDate) {
      return jsonError('New start date and end date are required', 400);
    }
    if (!body.newMonthlyRent || body.newMonthlyRent <= 0) {
      return jsonError('New monthly rent must be a positive number', 400);
    }

    const location = (lease.prop_address || lease.prop_name || '') as string;

    const terms: RenewalTerms = {
      tenantNames,
      propertyAddress: location,
      unitNumber: (lease.unit_number as string) || undefined,
      previousStartDate: (lease.start_date as string) || '',
      previousEndDate: (lease.end_date as string) || '',
      previousRent: Number(lease.monthly_rent) || 0,
      newStartDate: body.newStartDate,
      newEndDate: body.newEndDate,
      newMonthlyRent: body.newMonthlyRent,
      rentDueDay: body.rentDueDay ?? (Number(lease.rent_due_day) || 1),
      lateFeeAmount: body.lateFeeAmount ?? 50,
      lateFeeGraceDays: body.lateFeeGraceDays ?? 5,
      utilities: body.utilities || 'Tenant is responsible for all utilities.',
      additionalTerms: body.additionalTerms || undefined,
    };

    const result = await generateAndSaveRenewal(env, primaryTenant.id, terms);

    const docId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO documents (id, name, drive_file_id, content_type, size, property_id, tenant_id, uploaded_by)
       VALUES (?, ?, ?, 'application/pdf', 0, ?, ?, ?)`
    ).bind(docId, result.fileName, result.driveId, lease.property_id, primaryTenant.id, auth.id).run();

    const newLeaseId = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);

    await env.DB.prepare(
      `INSERT INTO leases (id, unit_id, property_id, start_date, end_date, monthly_rent,
        security_deposit, move_in_fee_paid, status, renewed_from_lease_id, renewal_generated_at,
        previous_rent, rent_due_day, user_id)
       VALUES (?, ?, ?, ?, ?, ?, 0, 1, 'active', ?, ?, ?, ?, ?)`
    ).bind(
      newLeaseId,
      lease.unit_id,
      lease.property_id,
      body.newStartDate,
      body.newEndDate,
      body.newMonthlyRent,
      leaseId,
      now,
      Number(lease.monthly_rent) || 0,
      body.rentDueDay ?? (Number(lease.rent_due_day) || 1),
      auth.id,
    ).run();

    const tenantInserts = tenants.results.map(t =>
      env.DB.prepare('INSERT INTO lease_tenants (id, lease_id, tenant_id) VALUES (?, ?, ?)')
        .bind(crypto.randomUUID(), newLeaseId, t.id)
    );

    await env.DB.prepare(
      `UPDATE leases SET status = 'ended', end_reason = 'Renewed', updated_at = unixepoch() WHERE id = ?`
    ).bind(leaseId).run();

    for (const stmt of tenantInserts) await stmt.run();

    if (body.emailToTenant && primaryTenant.email) {
      const rentChange = body.newMonthlyRent !== Number(lease.monthly_rent)
        ? ` Your new monthly rent is $${body.newMonthlyRent.toFixed(2)}.`
        : '';
      context.waitUntil(
        sendEmail(env, {
          to: primaryTenant.email,
          subject: 'Your Lease Renewal Agreement is Ready',
          text: `Hi ${primaryTenant.first_name},\n\nYour lease renewal agreement has been generated and is available in your tenant portal under Documents.${rentChange}\n\nPlease review it at your earliest convenience.\n\nThank you.`,
          html: `<p>Hi ${primaryTenant.first_name},</p><p>Your lease renewal agreement has been generated and is available in your tenant portal under Documents.${rentChange}</p><p>Please review it at your earliest convenience.</p><p>Thank you.</p>`,
        }).catch(e => console.error('renewal email failed', e))
      );
    }

    return jsonOk({
      success: true,
      data: {
        documentId: docId,
        driveId: result.driveId,
        fileName: result.fileName,
        newLeaseId,
        previousLeaseId: leaseId,
      },
    });
  } catch (err) {
    if (err instanceof DriveNotConnected) return jsonError('Google Drive is not connected. Connect it in Settings.', 503);
    return serverError();
  }
};
