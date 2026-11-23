import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../lib/session';
import { sendEmail, officeTenantEmail } from '../../lib/email';
import { serializeNotice } from '../../lib/serializers';
import { getManagementUserIds, notifyMultiple } from '../../lib/notify';

/**
 * POST /api/notices/non-renewal-toggle
 *
 * One-click non-renewal: creates the notice as "sent", emails the tenant,
 * logs the email, and adds a calendar event for the lease expiration.
 *
 * Body: { tenantId, leaseId, propertyId?, unitId? }
 */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requirePermission(env, request, 'tenants_edit');
  if (auth instanceof Response) return auth;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const { tenantId, leaseId, propertyId, unitId } = body as {
      tenantId?: string; leaseId?: string; propertyId?: string; unitId?: string;
    };

    if (!tenantId || !leaseId) {
      return jsonError('tenantId and leaseId are required', 400);
    }

    // Check if a non-renewal notice already exists for this tenant+lease
    const existing = await env.DB.prepare(
      `SELECT id FROM notices WHERE tenant_id = ? AND lease_id = ? AND type = 'non_renewal' LIMIT 1`
    ).bind(tenantId, leaseId).first();
    if (existing) {
      return jsonError('A non-renewal notice already exists for this lease', 409);
    }

    // Look up tenant
    const tenant = await env.DB.prepare(
      `SELECT first_name, last_name, email FROM tenants WHERE id = ?`
    ).bind(tenantId).first<{ first_name: string; last_name: string; email: string }>();
    if (!tenant) return jsonError('Tenant not found', 404);
    const tenantName = `${tenant.first_name} ${tenant.last_name}`.trim();

    // Look up lease
    const lease = await env.DB.prepare(
      `SELECT end_date, property_id, unit_id FROM leases WHERE id = ?`
    ).bind(leaseId).first<{ end_date: string; property_id: string; unit_id: string }>();
    if (!lease || !lease.end_date) return jsonError('Lease not found or has no end date', 404);

    const effectivePropertyId = propertyId || lease.property_id;
    const effectiveUnitId = unitId || lease.unit_id;

    // Look up property + unit labels
    let propertyAddress = '';
    let unitNumber = '';
    if (effectivePropertyId) {
      const prop = await env.DB.prepare('SELECT name, address FROM properties WHERE id = ?')
        .bind(effectivePropertyId).first<{ name: string; address: string }>();
      propertyAddress = prop?.address || prop?.name || '';
    }
    if (effectiveUnitId) {
      const unit = await env.DB.prepare('SELECT unit_number FROM units WHERE id = ?')
        .bind(effectiveUnitId).first<{ unit_number: string }>();
      unitNumber = unit?.unit_number || '';
    }

    // Load company settings
    let companyName = 'MH Dunn Property';
    let companyAddress = '';
    let companyPhone = '';
    try {
      const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'company'")
        .first<{ value: string }>();
      if (row?.value) {
        const co = JSON.parse(row.value);
        companyName = co.companyName || companyName;
        companyAddress = co.address ? `${co.address}, ${co.city || ''}, ${co.state || ''} ${co.zipCode || ''}`.trim() : '';
        companyPhone = co.phone || '';
      }
    } catch { /* use defaults */ }

    // Format the lease end date for display
    const endParts = lease.end_date.split('-');
    const leaseEndFormatted = endParts.length === 3
      ? `${parseInt(endParts[1])}/${parseInt(endParts[2])}/${endParts[0]}`
      : lease.end_date;

    const today = new Date();
    const todayStr = `${today.getMonth() + 1}/${today.getDate()}/${today.getFullYear()}`;

    const locationLabel = propertyAddress + (unitNumber ? `, Unit ${unitNumber}` : '');

    // Build notice body
    const noticeBody =
`Date: ${todayStr}

To: ${tenantName}
Property: ${locationLabel}

RE: Non-Renewal of Lease

Dear ${tenantName},

This letter serves as formal notice that your lease agreement for the above property will not be renewed upon its expiration on ${leaseEndFormatted}.

Please make arrangements to vacate the premises by the end of your current lease term. The unit should be left in clean condition, and all keys must be returned to our office.

Your security deposit will be handled in accordance with Illinois law. Please provide a forwarding address for the return of your deposit.

If you have any questions, please do not hesitate to contact us.

Sincerely,

${companyName}
${companyAddress}
${companyPhone}`;

    const noticeTitle = 'Notice of Non-Renewal';
    const todayDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    // 1. Create notice (status = sent, delivery = email)
    const noticeId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO notices (id, property_id, unit_id, lease_id, tenant_id, type, title, body, notice_date, delivery_method, status, delivered_at, created_by)
       VALUES (?, ?, ?, ?, ?, 'non_renewal', ?, ?, ?, 'email', 'sent', ?, ?)`
    ).bind(
      noticeId,
      effectivePropertyId || null,
      effectiveUnitId || null,
      leaseId,
      tenantId,
      noticeTitle,
      noticeBody,
      todayDate,
      todayDate,
      auth.id,
    ).run();

    // 2. Create calendar event for lease expiration
    const calendarId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO calendar_events (id, property_id, unit_id, title, description, category, event_date, priority, is_recurring, user_id, visibility)
       VALUES (?, ?, ?, ?, ?, 'lease_expiration', ?, 'high', 0, ?, 'shared')`
    ).bind(
      calendarId,
      effectivePropertyId || null,
      effectiveUnitId || null,
      `Non-Renewal: ${tenantName}`,
      `Lease expires. Non-renewal notice sent on ${todayStr}. ${locationLabel}`,
      lease.end_date,
      auth.id,
    ).run();

    // Also add to calendar_event_properties if the table exists
    if (effectivePropertyId) {
      try {
        await env.DB.prepare(
          `INSERT OR IGNORE INTO calendar_event_properties (event_id, property_id) VALUES (?, ?)`
        ).bind(calendarId, effectivePropertyId).run();
      } catch { /* table may not exist */ }
    }

    // 3. Email the tenant (background, best-effort)
    context.waitUntil((async () => {
      if (!tenant.email) return;
      try {
        const emailBody = `This letter serves as formal notice that your lease agreement for ${locationLabel} will not be renewed upon its expiration on ${leaseEndFormatted}.\n\nPlease make arrangements to vacate the premises by the end of your current lease term. The unit should be left in clean condition, and all keys must be returned to our office.\n\nYour security deposit will be handled in accordance with Illinois law. Please provide a forwarding address for the return of your deposit.\n\nIf you have any questions, please do not hesitate to contact us.`;

        const { html, text } = officeTenantEmail(emailBody, tenant.first_name);
        await sendEmail(env, {
          to: tenant.email,
          subject: `Non-Renewal of Lease: ${locationLabel}`,
          html,
          text,
        });

        // Log the email in tenant_emails
        await env.DB.prepare(
          `INSERT INTO tenant_emails (id, tenant_id, sent_by_user_id, to_email, subject, body, delivered)
           VALUES (?, ?, ?, ?, ?, ?, 1)`
        ).bind(
          crypto.randomUUID(),
          tenantId,
          auth.id,
          tenant.email,
          `Non-Renewal of Lease: ${locationLabel}`,
          emailBody,
        ).run();
      } catch (e) {
        console.error('Non-renewal email failed:', e);
      }
    })());

    // 4. Notify management
    context.waitUntil(
      getManagementUserIds(env, auth.id).then(userIds =>
        notifyMultiple(env, userIds.map(uid => ({
          userId: uid,
          type: 'tenant' as const,
          category: 'notice_created',
          title: `Non-renewal notice sent to ${tenantName}`,
          message: `Lease expires ${leaseEndFormatted}. Email sent. Calendar event added.`,
          entityType: 'notice',
          entityId: noticeId,
          route: '/notices',
        })))
      ).catch(() => {})
    );

    // Return the created notice
    const row = await env.DB.prepare(
      `SELECT n.*, t.first_name || ' ' || t.last_name AS tenant_name,
       p.name AS property_name, u.unit_number
       FROM notices n
       LEFT JOIN tenants t ON n.tenant_id = t.id
       LEFT JOIN properties p ON n.property_id = p.id
       LEFT JOIN units u ON n.unit_id = u.id
       WHERE n.id = ?`
    ).bind(noticeId).first();

    return jsonOk({
      success: true,
      data: {
        ...serializeNotice(row as Record<string, unknown>),
        tenantName: (row as Record<string, unknown>).tenant_name ?? undefined,
        propertyName: (row as Record<string, unknown>).property_name ?? undefined,
        unitNumber: (row as Record<string, unknown>).unit_number ?? undefined,
        calendarEventId: calendarId,
      },
    }, 201);
  } catch (e) {
    console.error('non-renewal-toggle error:', e);
    return serverError();
  }
};
