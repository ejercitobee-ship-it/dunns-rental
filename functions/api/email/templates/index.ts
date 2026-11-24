import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../../lib/session';
import { serializeEmailTemplate } from '../../../lib/serializers';
import { stripDangerousHtml } from '../../../lib/sanitize';
import { logActivityStmt } from '../../../lib/activity';

/** GET /api/email/templates — list all email templates. */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requirePermission(env, request, 'announcements_send');
  if (auth instanceof Response) return auth;
  try {
    const { results } = await env.DB.prepare(
      'SELECT * FROM email_templates ORDER BY category, name'
    ).all();
    return jsonOk({ success: true, data: (results || []).map((r) => serializeEmailTemplate(r as Record<string, unknown>)) });
  } catch {
    return serverError();
  }
};

/** POST /api/email/templates — create a template. */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requirePermission(env, request, 'announcements_send');
  if (auth instanceof Response) return auth;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return jsonError('A template name is required', 400);
    const category = typeof body.category === 'string' && body.category.trim() ? body.category.trim() : 'custom';
    const subject = typeof body.subject === 'string' ? body.subject.trim() : '';
    const previewText = typeof body.previewText === 'string' ? body.previewText.trim() : null;
    const bodyHtml = stripDangerousHtml(typeof body.bodyHtml === 'string' ? body.bodyHtml : '');

    const id = `tmpl_${crypto.randomUUID()}`;
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO email_templates (id, name, category, subject, preview_text, body_html, is_system, created_by)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?)`
      ).bind(id, name, category, subject, previewText, bodyHtml, auth.id),
      logActivityStmt(env.DB, auth, {
        module: 'settings',
        action: 'Created an email template',
        description: `"${name}"`,
        targetType: 'email_template',
        targetId: id,
      }),
    ]);

    const row = await env.DB.prepare('SELECT * FROM email_templates WHERE id = ?').bind(id).first();
    return jsonOk({ success: true, data: serializeEmailTemplate(row as Record<string, unknown>) }, 201);
  } catch {
    return serverError();
  }
};
