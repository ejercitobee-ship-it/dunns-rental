import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../../lib/session';
import { serializeEmailCampaign } from '../../../lib/serializers';
import { stripDangerousHtml } from '../../../lib/sanitize';
import { logActivityStmt } from '../../../lib/activity';

/** GET /api/email/campaigns — list campaigns (newest first). */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requirePermission(env, request, 'announcements_send');
  if (auth instanceof Response) return auth;
  try {
    const { results } = await env.DB.prepare(
      'SELECT * FROM email_campaigns ORDER BY created_at DESC'
    ).all();
    return jsonOk({ success: true, data: (results || []).map((r) => serializeEmailCampaign(r as Record<string, unknown>)) });
  } catch {
    return serverError();
  }
};

/** POST /api/email/campaigns — create a draft campaign. */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requirePermission(env, request, 'announcements_send');
  if (auth instanceof Response) return auth;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return jsonError('A campaign name is required', 400);
    const category = typeof body.category === 'string' && body.category.trim() ? body.category.trim() : 'custom';
    const subject = typeof body.subject === 'string' ? body.subject.trim() : '';
    const previewText = typeof body.previewText === 'string' ? body.previewText.trim() : null;
    const bodyHtml = stripDangerousHtml(typeof body.bodyHtml === 'string' ? body.bodyHtml : '');
    const templateId = typeof body.templateId === 'string' ? body.templateId : null;
    const recipientFilter = body.recipientFilter ? JSON.stringify(body.recipientFilter) : null;
    const recipientCount = Number.isFinite(body.recipientCount) ? Number(body.recipientCount) : 0;

    const id = `camp_${crypto.randomUUID()}`;
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO email_campaigns (id, name, category, subject, preview_text, body_html, template_id, recipient_filter, recipient_count, status, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?)`
      ).bind(id, name, category, subject, previewText, bodyHtml, templateId, recipientFilter, recipientCount, auth.id),
      logActivityStmt(env.DB, auth, {
        module: 'settings', action: 'Created an email campaign', description: `"${name}"`,
        targetType: 'email_campaign', targetId: id,
      }),
    ]);
    const row = await env.DB.prepare('SELECT * FROM email_campaigns WHERE id = ?').bind(id).first();
    return jsonOk({ success: true, data: serializeEmailCampaign(row as Record<string, unknown>) }, 201);
  } catch {
    return serverError();
  }
};
