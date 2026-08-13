import type { PagesFunction } from '@cloudflare/workers-types';
import type { Env } from '../../lib/session';
import { sendEmail, vendorSubmissionStatusEmail } from '../../lib/email';

function jsonOk(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function jsonError(message: string, status = 400) {
  return new Response(JSON.stringify({ success: false, error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * GET /api/vendor-form/:token — public, no auth. Returns the form data for
 * the vendor to fill out. Includes property list + units so the vendor can
 * pick where they did the work.
 */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, params } = context;

  try {
    const token = params.token as string;
    const sub = await env.DB.prepare(
      `SELECT vs.*, m.title AS job_title,
              p.name AS prop_name, p.address AS prop_address
         FROM vendor_submissions vs
         LEFT JOIN maintenance_requests m ON m.id = vs.maintenance_request_id
         LEFT JOIN properties p ON p.id = vs.property_id
        WHERE vs.token = ?`
    ).bind(token).first<Record<string, unknown>>();

    if (!sub) return jsonError('This link is not valid or has expired.', 404);
    if (sub.status !== 'draft' && sub.status !== 'submitted') {
      return jsonOk({
        success: true,
        data: {
          status: sub.status as string,
          alreadySubmitted: true,
          companyName: sub.company_name,
          vendorName: sub.vendor_name,
        },
      });
    }

    // Fetch properties and units so the vendor can pick/confirm.
    const { results: props } = await env.DB.prepare(
      'SELECT id, name, address FROM properties ORDER BY name'
    ).all();
    const { results: unitRows } = await env.DB.prepare(
      'SELECT id, property_id, unit_number FROM units ORDER BY unit_number'
    ).all();

    return jsonOk({
      success: true,
      data: {
        status: sub.status,
        alreadySubmitted: sub.status === 'submitted',
        vendorName: sub.vendor_name || '',
        companyName: sub.company_name || '',
        vendorEmail: sub.vendor_email || '',
        vendorPhone: sub.vendor_phone || '',
        propertyId: sub.property_id || '',
        unitId: sub.unit_id || '',
        workDescription: sub.work_description || '',
        amount: sub.amount,
        paymentMethod: sub.payment_method || '',
        jobTitle: sub.job_title || '',
        propName: sub.prop_name || '',
        propAddress: sub.prop_address || '',
        rejectionReason: sub.rejection_reason || null,
        properties: (props || []).map((p: Record<string, unknown>) => ({
          id: p.id, name: p.name, address: p.address,
        })),
        units: (unitRows || []).map((u: Record<string, unknown>) => ({
          id: u.id, propertyId: u.property_id, unitNumber: u.unit_number,
        })),
      },
    });
  } catch {
    return new Response(JSON.stringify({ success: false, error: 'Server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

/**
 * POST /api/vendor-form/:token — public, no auth. The vendor submits their
 * invoice details. Moves the submission to "submitted" status and notifies
 * the office.
 */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, params, request } = context;

  try {
    const token = params.token as string;
    const sub = await env.DB.prepare(
      'SELECT id, status, maintenance_request_id FROM vendor_submissions WHERE token = ?'
    ).bind(token).first<{ id: string; status: string; maintenance_request_id: string | null }>();

    if (!sub) return jsonError('This link is not valid or has expired.', 404);
    if (sub.status !== 'draft') {
      return jsonError('This form has already been submitted.', 409);
    }

    const body = (await request.json()) as Record<string, unknown>;
    const vendorName = ((body.vendorName as string) || '').trim();
    const companyName = ((body.companyName as string) || '').trim();
    const vendorEmail = ((body.vendorEmail as string) || '').trim();
    const vendorPhone = ((body.vendorPhone as string) || '').trim();
    const propertyId = ((body.propertyId as string) || '').trim();
    const unitId = ((body.unitId as string) || '').trim();
    const workDescription = ((body.workDescription as string) || '').trim();
    const amount = Number(body.amount);
    const paymentMethod = ((body.paymentMethod as string) || '').trim();

    if (!vendorName) return jsonError('Please enter your name.');
    if (!amount || !Number.isFinite(amount) || amount <= 0) return jsonError('Please enter a valid amount.');
    if (!propertyId) return jsonError('Please select a property.');

    await env.DB.prepare(
      `UPDATE vendor_submissions
          SET vendor_name = ?, company_name = ?, vendor_email = ?, vendor_phone = ?,
              property_id = ?, unit_id = NULLIF(?, ''), work_description = ?,
              amount = ?, payment_method = ?,
              status = 'submitted', submitted_at = unixepoch(), updated_at = unixepoch()
        WHERE id = ?`
    ).bind(
      vendorName, companyName, vendorEmail, vendorPhone,
      propertyId, unitId, workDescription,
      amount, paymentMethod,
      sub.id
    ).run();

    // Send "received" confirmation to the vendor.
    if (vendorEmail) {
      const jobTitle = sub.maintenance_request_id
        ? (await env.DB.prepare('SELECT title FROM maintenance_requests WHERE id = ?')
            .bind(sub.maintenance_request_id).first<{ title: string }>())?.title
        : undefined;

      context.waitUntil(
        sendEmail(env, {
          to: vendorEmail,
          ...vendorSubmissionStatusEmail({
            vendorName, status: 'received', jobTitle,
          }),
        }).catch(e => console.error('vendor received email failed', e))
      );
    }

    return jsonOk({ success: true });
  } catch {
    return new Response(JSON.stringify({ success: false, error: 'Server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
