import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../../../lib/session';
import { serializeEmailTemplate } from '../../../../lib/serializers';
import { logActivityStmt } from '../../../../lib/activity';

/** POST /api/email/templates/:id/duplicate — copy a template. */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'announcements_send');
  if (auth instanceof Response) return auth;
  try {
    const src = await env.DB.prepare('SELECT * FROM email_templates WHERE id = ?')
      .bind(params.id as string)
      .first<{ name: string; category: string; subject: string; preview_text: string | null; body_html: string }>();
    if (!src) return jsonError('Template not found', 404);

    const id = `tmpl_${crypto.randomUUID()}`;
    const name = `${src.name} (copy)`;
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO email_templates (id, name, category, subject, preview_text, body_html, is_system, created_by)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?)`
      ).bind(id, name, src.category, src.subject, src.preview_text, src.body_html, auth.id),
      logActivityStmt(env.DB, auth, {
        module: 'settings',
        action: 'Duplicated an email template',
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
