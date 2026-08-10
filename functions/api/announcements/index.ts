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
              u.name AS author_name
         FROM announcements a
         LEFT JOIN properties p ON p.id = a.property_id
         LEFT JOIN user u ON u.id = a.created_by
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

    const expiresAt = typeof body.expiresAt === 'string' && body.expiresAt ? body.expiresAt : null;

    // Accept propertyIds (array) or legacy propertyId (single string).
    let propertyIds: string[] = [];
    if (Array.isArray(body.propertyIds)) {
      propertyIds = body.propertyIds.filter((v): v is string => typeof v === 'string' && v !== '');
    } else if (typeof body.propertyId === 'string' && body.propertyId) {
      propertyIds = [body.propertyId];
    }
    // Empty array = all properties (property_id NULL).

    // Resolve property names for the email and activity log.
    const propertyNames: Record<string, string> = {};
    if (propertyIds.length > 0) {
      const placeholders = propertyIds.map(() => '?').join(',');
      const { results } = await env.DB.prepare(
        `SELECT id, name FROM properties WHERE id IN (${placeholders})`
      ).bind(...propertyIds).all<{ id: string; name: string }>();
      for (const r of results || []) propertyNames[r.id] = r.name;
    }

    // One announcement row per property (or one with NULL for "all").
    const targets = propertyIds.length > 0 ? propertyIds : [null];
    const statements: ReturnType<typeof env.DB.prepare>[] = [];
    const ids: string[] = [];
    for (const pid of targets) {
      const id = crypto.randomUUID();
      ids.push(id);
      statements.push(
        env.DB.prepare(
          `INSERT INTO announcements (id, title, body, property_id, created_by, expires_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        ).bind(id, title, text, pid, auth.id, expiresAt),
      );
    }
    const nameList = propertyIds.length > 0
      ? propertyIds.map(pid => propertyNames[pid] || pid).join(', ')
      : 'all properties';
    statements.push(
      logActivityStmt(env.DB, auth, {
        module: 'settings',
        action: 'Sent announcement',
        description: `"${title}" to ${nameList}`,
      }),
    );
    await env.DB.batch(statements);

    // Find all active tenants at the target properties (or all).
    let tenantQuery: string;
    let tenantResult: { results: { tenant_id: string; first_name: string; email: string | null }[] | null };
    if (propertyIds.length > 0) {
      const placeholders = propertyIds.map(() => '?').join(',');
      tenantQuery = `SELECT DISTINCT t.id AS tenant_id, t.first_name, t.email
           FROM tenants t
           JOIN lease_tenants lt ON lt.tenant_id = t.id
           JOIN leases l ON l.id = lt.lease_id AND l.status = 'active'
          WHERE l.property_id IN (${placeholders})`;
      tenantResult = await env.DB.prepare(tenantQuery).bind(...propertyIds)
        .all<{ tenant_id: string; first_name: string; email: string | null }>();
    } else {
      tenantQuery = `SELECT DISTINCT t.id AS tenant_id, t.first_name, t.email
           FROM tenants t
           JOIN lease_tenants lt ON lt.tenant_id = t.id
           JOIN leases l ON l.id = lt.lease_id AND l.status = 'active'`;
      tenantResult = await env.DB.prepare(tenantQuery)
        .all<{ tenant_id: string; first_name: string; email: string | null }>();
    }

    const tenants = tenantResult.results || [];
    let emailsSent = 0;
    let pushSent = 0;

    // Fan out emails and push notifications. Best-effort: a single failure
    // doesn't block the rest.
    const propertyLabel = propertyIds.length === 1
      ? propertyNames[propertyIds[0]] : undefined;
    context.waitUntil((async () => {
      for (const tenant of tenants) {
        // Email
        if (tenant.email) {
          try {
            const mail = announcementEmail({
              title,
              body: text,
              propertyName: propertyLabel,
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
      console.log(`announcements [${ids.join(',')}]: ${emailsSent} emails, ${pushSent} push to ${tenants.length} tenants`);
    })());

    return jsonOk({
      success: true,
      data: { ids, recipientCount: tenants.length },
    }, 201);
  } catch {
    return serverError();
  }
};
