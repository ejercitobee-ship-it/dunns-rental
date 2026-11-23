import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../lib/session';
import { sendEmail, tenantReminderEmail } from '../../lib/email';
import { sendPushToTenant } from '../../lib/push';
import { logActivityStmt } from '../../lib/activity';
import { SITE_URL } from '../../lib/site';

/**
 * POST /api/tenants/reminder-blast
 *
 * Send a reminder, by email and push, to every ACTIVE tenant. Secured behind
 * the announcements_send permission (the "send bulk comms to tenants" right).
 * The recipient list is derived server side from active leases, never from the
 * client, so a caller cannot target or spoof recipients. The blast is logged in
 * the activity log, then fans out best effort so one failure never blocks the rest.
 */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requirePermission(env, request, 'announcements_send');
  if (auth instanceof Response) return auth;

  try {
    const body = (await request.json()) as { subject?: string; message?: string };
    const subject = typeof body.subject === 'string' ? body.subject.trim() : '';
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    if (!subject) return jsonError('A subject is required', 400);
    if (!message) return jsonError('A message is required', 400);

    const { results } = await env.DB.prepare(
      `SELECT DISTINCT t.id AS tenant_id, t.first_name, t.email
         FROM tenants t
         JOIN lease_tenants lt ON lt.tenant_id = t.id
         JOIN leases l ON l.id = lt.lease_id AND l.status = 'active'`
    ).all<{ tenant_id: string; first_name: string; email: string | null }>();
    const tenants = results || [];

    // Record the blast (who sent it, to how many) before fanning out.
    await logActivityStmt(env.DB, auth, {
      module: 'tenants',
      action: 'Sent a reminder to all tenants',
      description: `"${subject}" to ${tenants.length} tenant${tenants.length === 1 ? '' : 's'}`,
    }).run();

    context.waitUntil((async () => {
      let emails = 0;
      let push = 0;
      const pushBody = message.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      for (const t of tenants) {
        if (t.email) {
          try {
            const mail = tenantReminderEmail({ subject, message, tenantName: t.first_name });
            await sendEmail(env, { to: t.email, subject: mail.subject, html: mail.html, text: mail.text });
            emails++;
          } catch (err) {
            console.error(`reminder email failed for ${t.tenant_id}:`, err);
          }
        }
        try {
          await sendPushToTenant(env, t.tenant_id, {
            title: `Reminder: ${subject}`,
            body: pushBody.length > 120 ? pushBody.slice(0, 117) + '...' : pushBody,
            url: `${SITE_URL}/portal`,
          });
          push++;
        } catch (err) {
          console.error(`reminder push failed for ${t.tenant_id}:`, err);
        }
      }
      console.log(`reminder blast: ${emails} emails, ${push} push to ${tenants.length} tenants`);
    })());

    return jsonOk({ success: true, data: { recipientCount: tenants.length } });
  } catch {
    return serverError();
  }
};
