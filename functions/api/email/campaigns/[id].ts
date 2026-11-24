import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../../lib/session';
import { serializeEmailCampaign } from '../../../lib/serializers';
import { stripDangerousHtml } from '../../../lib/sanitize';
import { logActivityStmt } from '../../../lib/activity';

/** GET /api/email/campaigns/:id */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'announcements_send');
  if (auth instanceof Response) return auth;
  try {
    const row = await env.DB.prepare('SELECT * FROM email_campaigns WHERE id = ?').bind(params.id as string).first();
    if (!row) return jsonError('Campaign not found', 404);
    return jsonOk({ success: true, data: serializeEmailCampaign(row as Record<string, unknown>) });
  } catch {
    return serverError();
  }
};

/** PUT /api/email/campaigns/:id — update a draft campaign. */
export const onRequestPut: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'announcements_send');
  if (auth instanceof Response) return auth;
  try {
    const id = params.id as string;
    const existing = await env.DB.prepare('SELECT status FROM email_campaigns WHERE id = ?').bind(id).first<{ status: string }>();
    if (!existing) return jsonError('Campaign not found', 404);
    if (existing.status !== 'draft' && existing.status !== 'scheduled') {
      return jsonError('Only a draft or scheduled campaign can be edited', 409);
    }
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

    await env.DB.batch([
      env.DB.prepare(
        `UPDATE email_campaigns
            SET name = ?, category = ?, subject = ?, preview_text = ?, body_html = ?,
                template_id = ?, recipient_filter = ?, recipient_count = ?, updated_at = unixepoch()
          WHERE id = ?`
      ).bind(name, category, subject, previewText, bodyHtml, templateId, recipientFilter, recipientCount, id),
      logActivityStmt(env.DB, auth, {
        module: 'settings', action: 'Edited an email campaign', description: `"${name}"`,
        targetType: 'email_campaign', targetId: id,
      }),
    ]);
    const row = await env.DB.prepare('SELECT * FROM email_campaigns WHERE id = ?').bind(id).first();
    return jsonOk({ success: true, data: serializeEmailCampaign(row as Record<string, unknown>) });
  } catch {
    return serverError();
  }
};

/** DELETE /api/email/campaigns/:id — delete a draft/canceled campaign. */
export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'announcements_send');
  if (auth instanceof Response) return auth;
  try {
    const id = params.id as string;
    const existing = await env.DB.prepare('SELECT name, status FROM email_campaigns WHERE id = ?').bind(id).first<{ name: string; status: string }>();
    if (!existing) return jsonError('Campaign not found', 404);
    if (existing.status === 'processing') return jsonError('A sending campaign cannot be deleted', 409);
    await env.DB.batch([
      env.DB.prepare('DELETE FROM email_campaigns WHERE id = ?').bind(id),
      logActivityStmt(env.DB, auth, {
        module: 'settings', action: 'Deleted an email campaign', description: `"${existing.name}"`,
        targetType: 'email_campaign', targetId: id,
      }),
    ]);
    return jsonOk({ success: true });
  } catch {
    return serverError();
  }
};
