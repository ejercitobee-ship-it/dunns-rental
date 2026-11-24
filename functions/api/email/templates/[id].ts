import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../../lib/session';
import { serializeEmailTemplate } from '../../../lib/serializers';
import { stripDangerousHtml } from '../../../lib/sanitize';
import { logActivityStmt } from '../../../lib/activity';

/** GET /api/email/templates/:id */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'announcements_send');
  if (auth instanceof Response) return auth;
  try {
    const row = await env.DB.prepare('SELECT * FROM email_templates WHERE id = ?')
      .bind(params.id as string).first();
    if (!row) return jsonError('Template not found', 404);
    return jsonOk({ success: true, data: serializeEmailTemplate(row as Record<string, unknown>) });
  } catch {
    return serverError();
  }
};

/** PUT /api/email/templates/:id */
export const onRequestPut: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'announcements_send');
  if (auth instanceof Response) return auth;
  try {
    const id = params.id as string;
    const existing = await env.DB.prepare('SELECT id FROM email_templates WHERE id = ?').bind(id).first();
    if (!existing) return jsonError('Template not found', 404);

    const body = (await request.json()) as Record<string, unknown>;
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return jsonError('A template name is required', 400);
    const category = typeof body.category === 'string' && body.category.trim() ? body.category.trim() : 'custom';
    const subject = typeof body.subject === 'string' ? body.subject.trim() : '';
    const previewText = typeof body.previewText === 'string' ? body.previewText.trim() : null;
    const bodyHtml = stripDangerousHtml(typeof body.bodyHtml === 'string' ? body.bodyHtml : '');

    await env.DB.batch([
      env.DB.prepare(
        `UPDATE email_templates
            SET name = ?, category = ?, subject = ?, preview_text = ?, body_html = ?, updated_at = unixepoch()
          WHERE id = ?`
      ).bind(name, category, subject, previewText, bodyHtml, id),
      logActivityStmt(env.DB, auth, {
        module: 'settings',
        action: 'Edited an email template',
        description: `"${name}"`,
        targetType: 'email_template',
        targetId: id,
      }),
    ]);

    const row = await env.DB.prepare('SELECT * FROM email_templates WHERE id = ?').bind(id).first();
    return jsonOk({ success: true, data: serializeEmailTemplate(row as Record<string, unknown>) });
  } catch {
    return serverError();
  }
};

/** DELETE /api/email/templates/:id */
export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'announcements_send');
  if (auth instanceof Response) return auth;
  try {
    const id = params.id as string;
    const existing = await env.DB.prepare('SELECT name FROM email_templates WHERE id = ?')
      .bind(id).first<{ name: string }>();
    if (!existing) return jsonError('Template not found', 404);

    await env.DB.batch([
      env.DB.prepare('DELETE FROM email_templates WHERE id = ?').bind(id),
      logActivityStmt(env.DB, auth, {
        module: 'settings',
        action: 'Deleted an email template',
        description: `"${existing.name}"`,
        targetType: 'email_template',
        targetId: id,
      }),
    ]);
    return jsonOk({ success: true });
  } catch {
    return serverError();
  }
};
