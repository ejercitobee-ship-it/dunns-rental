import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../../lib/session';
import { sendEmail, officeTenantEmail } from '../../../lib/email';

const MAX_SUBJECT = 200;
const MAX_BODY = 8000;

function serializeTenantEmail(r: Record<string, unknown>) {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    sentByUserId: r.sent_by_user_id ?? undefined,
    toEmail: r.to_email,
    subject: r.subject,
    body: r.body,
    delivered: !!r.delivered,
    createdAt: r.created_at,
  };
}

/** GET /api/tenants/:id/emails — the office correspondence log for a tenant. */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'tenants_view');
  if (auth instanceof Response) return auth;
  try {
    const { results } = await env.DB.prepare(
      'SELECT * FROM tenant_emails WHERE tenant_id = ? ORDER BY created_at DESC'
    ).bind(params.id as string).all();
    return jsonOk({ success: true, data: (results || []).map(serializeTenantEmail) });
  } catch {
    return serverError();
  }
};

/** POST /api/tenants/:id/emails — send an email to the tenant and log it. */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'tenants_edit');
  if (auth instanceof Response) return auth;
  try {
    const id = params.id as string;
    const tenant = await env.DB.prepare('SELECT first_name, last_name, email FROM tenants WHERE id = ?')
      .bind(id)
      .first<{ first_name: string; last_name: string; email: string | null }>();
    if (!tenant) return jsonError('Tenant not found', 404);
    if (!tenant.email) return jsonError('This tenant has no email address on file.', 400);

    const raw = (await request.json()) as { subject?: string; body?: string };
    const subject = (raw.subject || '').trim();
    const body = (raw.body || '').trim();
    if (!subject) return jsonError('Please add a subject.', 400);
    if (!body) return jsonError('Please write a message.', 400);
    if (subject.length > MAX_SUBJECT) return jsonError('That subject is too long.', 400);
    if (body.length > MAX_BODY) return jsonError('That message is too long.', 400);

    const name = `${tenant.first_name} ${tenant.last_name}`.trim() || undefined;
    const { html, text } = officeTenantEmail(body, name);
    const delivered = await sendEmail(env, { to: tenant.email, subject, html, text });

    const rowId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO tenant_emails (id, tenant_id, sent_by_user_id, to_email, subject, body, delivered)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(rowId, id, auth.id, tenant.email, subject, body, delivered ? 1 : 0).run();

    if (!delivered) {
      return jsonError('The email could not be sent (check the email service). It was saved to the log as not delivered.', 502);
    }

    const row = await env.DB.prepare('SELECT * FROM tenant_emails WHERE id = ?').bind(rowId).first();
    return jsonOk({ success: true, data: serializeTenantEmail(row as Record<string, unknown>) }, 201);
  } catch {
    return serverError();
  }
};
