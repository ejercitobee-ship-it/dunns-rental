import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../../lib/session';
import { sendEmail, vendorFormInviteEmail } from '../../../lib/email';
import { SITE_URL } from '../../../lib/site';

/**
 * POST /api/maintenance/:id/vendor-link — generate a secure, no-login invoice
 * form link for a vendor and optionally email it to them.
 *
 * Body: { vendorEmail?: string, vendorName?: string }
 *
 * Creates a vendor_submissions row in "draft" status with a unique token.
 * If vendorEmail is provided, the invite email is sent automatically.
 * Returns the form URL + submission ID.
 */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'maintenance_approve');
  if (auth instanceof Response) return auth;

  try {
    const maintId = params.id as string;
    const body = (await request.json()) as Record<string, unknown>;
    const vendorEmail = ((body.vendorEmail as string) || '').trim();
    const vendorName = ((body.vendorName as string) || '').trim();

    // Look up the maintenance request for context.
    const req = await env.DB.prepare(
      `SELECT m.title, m.property_id, m.unit_id, m.vendor,
              p.name AS prop_name, p.address AS prop_address
         FROM maintenance_requests m
         LEFT JOIN properties p ON p.id = m.property_id
        WHERE m.id = ?`
    ).bind(maintId).first<{
      title: string; property_id: string | null; unit_id: string | null;
      vendor: string | null; prop_name: string | null; prop_address: string | null;
    }>();
    if (!req) return jsonError('Maintenance request not found', 404);

    const id = crypto.randomUUID();
    const token = crypto.randomUUID();

    await env.DB.prepare(
      `INSERT INTO vendor_submissions
         (id, token, maintenance_request_id, vendor_name, vendor_email, property_id, unit_id,
          work_description, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?)`
    ).bind(
      id, token, maintId,
      vendorName || req.vendor || '',
      vendorEmail,
      req.property_id,
      req.unit_id,
      req.title,
      auth.id
    ).run();

    const url = `${SITE_URL}/vendor-form/${token}`;

    // Email the vendor if we have their address.
    let emailed = false;
    if (vendorEmail) {
      const emailPayload = vendorFormInviteEmail({
        url,
        vendorName: vendorName || req.vendor || undefined,
        jobTitle: req.title,
        propertyAddress: req.prop_address || req.prop_name || undefined,
      });
      emailed = await sendEmail(env, { to: vendorEmail, ...emailPayload });
    }

    return jsonOk({
      success: true,
      data: { id, token, url, emailed, emailedTo: vendorEmail || null },
    }, 201);
  } catch {
    return serverError();
  }
};
