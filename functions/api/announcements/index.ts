import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../lib/session';
import { sendEmail, announcementEmail } from '../../lib/email';
import { sendPushToTenant } from '../../lib/push';
import { logActivityStmt } from '../../lib/activity';
import { SITE_URL } from '../../lib/site';

/** GET /api/announcements — list all announcements (admin). */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requirePermission(env, request, 'announcements_send');
  if (auth instanceof Response) return auth;

  try {
    const { results } = await env.DB.prepare(
      `SELECT a.*, p.name AS property_name, u.email AS author_email,
              u.first_name || ' ' || u.last_name AS author_name
         FROM announcements a
         LEFT JOIN properties p ON p.id = a.property_id
         LEFT JOIN users u ON u.id = a.created_by
        ORDER BY a.created_at DESC`
    ).all();
    return jsonOk({ success: true, data: results || [] });
  } catch {
    return serverError();
  }
};

/** POST /api/announcements — create + email + push to affected tenants. */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requirePermission(env, request, 'announcements_send');
  if (auth instanceof Response) return auth;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    const text = typeof body.body === 'string' ? body.body.trim() : '';
    if (!title) return jsonError('Title is required', 400);
    if (!text) return jsonError('Message body is required', 400);

    const propertyId = typeof body.propertyId === 'string' && body.propertyId ? body.propertyId : null;
    const expiresAt = typeof body.expiresAt === 'string' && body.expiresAt ? body.expiresAt : null;

    // Look up property name for the email.
    let propertyName: string | undefined;
    if (propertyId) {
      const prop = await env.DB.prepare('SELECT name FROM properties WHERE id = ?')
        .bind(propertyId).first<{ name: string }>();
      propertyName = prop?.name;
    }

    const id = crypto.randomUUID();
    const statements = [
      env.DB.prepare(
        `INSERT INTO announcements (id, title, body, property_id, created_by, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(id, title, text, propertyId, auth.id, expiresAt),
      logActivityStmt(env.DB, auth, {
        module: 'settings',
        action: 'Sent announcement',
        description: propertyName ? `"${title}" to ${propertyName}` : `"${title}" to all properties`,
      }),
    ];
    await env.DB.batch(statements);

    // Find all active tenants at the target property (or all properties).
    const tenantQuery = propertyId
      ? `SELECT DISTINCT t.id AS tenant_id, t.first_name, t.email
           FROM tenants t
           JOIN lease_tenants lt ON lt.tenant_id = t.id
           JOIN leases l ON l.id = lt.lease_id AND l.status = 'active'
          WHERE l.property_id = ?`
      : `SELECT DISTINCT t.id AS tenant_id, t.first_name, t.email
           FROM tenants t
           JOIN lease_tenants lt ON lt.tenant_id = t.id
           JOIN leases l ON l.id = lt.lease_id AND l.status = 'active'`;

    const tenantResult = propertyId
      ? await env.DB.prepare(tenantQuery).bind(propertyId).all<{ tenant_id: string; first_name: string; email: string | null }>()
      : await env.DB.prepare(tenantQuery).all<{ tenant_id: string; first_name: string; email: string | null }>();

    const tenants = tenantResult.results || [];
    let emailsSent = 0;
    let pushSent = 0;

    // Fan out emails and push notifications. Best-effort: a single failure
    // doesn't block the rest.
    context.waitUntil((async () => {
      for (const tenant of tenants) {
        // Email
        if (tenant.email) {
          try {
            const mail = announcementEmail({
              title,
              body: text,
              propertyName,
              tenantName: tenant.first_name,
            });
            await sendEmail(env, { to: tenant.email, subject: mail.subject, html: mail.html, text: mail.text });
            emailsSent++;
          } catch (err) {
            console.error(`announcement email failed for ${tenant.tenant_id}:`, err);
          }
        }
        // Push
        try {
          await sendPushToTenant(env, tenant.tenant_id, {
            title: `📢 ${title}`,
            body: text.length > 120 ? text.slice(0, 117) + '...' : text,
            url: `${SITE_URL}/portal`,
          });
          pushSent++;
        } catch (err) {
          console.error(`announcement push failed for ${tenant.tenant_id}:`, err);
        }
      }
      console.log(`announcement ${id}: ${emailsSent} emails, ${pushSent} push to ${tenants.length} tenants`);
    })());

    return jsonOk({
      success: true,
      data: { id, recipientCount: tenants.length },
    }, 201);
  } catch {
    return serverError();
  }
};
