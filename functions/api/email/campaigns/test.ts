import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../../lib/session';
import { sendEmail } from '../../../lib/email';
import { renderTemplate, SAMPLE_CONTEXT } from '../../../lib/personalize';
import { stripDangerousHtml } from '../../../lib/sanitize';

/**
 * POST /api/email/campaigns/test — send ONE test email of the campaign content
 * to a chosen address (defaults to the sender's own email), rendered with
 * sample personalization data. A test send never touches tenants, campaign
 * analytics, or automations.
 */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requirePermission(env, request, 'announcements_send');
  if (auth instanceof Response) return auth;
  try {
    const body = (await request.json()) as { subject?: string; bodyHtml?: string; to?: string };
    const to = (typeof body.to === 'string' && body.to.trim()) ? body.to.trim() : auth.email;
    if (!to || !to.includes('@')) return jsonError('A valid test email address is required', 400);
    const subject = typeof body.subject === 'string' ? body.subject.trim() : '';
    const rawHtml = stripDangerousHtml(typeof body.bodyHtml === 'string' ? body.bodyHtml : '');
    if (!subject && !rawHtml) return jsonError('Add a subject or message before sending a test', 400);

    const renderedHtml = renderTemplate(rawHtml, SAMPLE_CONTEXT);
    const renderedSubject = renderTemplate(subject, SAMPLE_CONTEXT);
    const text = renderedHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

    const ok = await sendEmail(env, {
      to,
      subject: `[TEST] ${renderedSubject || 'Campaign preview'}`,
      html: renderedHtml || '<p>(no content)</p>',
      text: text || '(no content)',
    });
    if (!ok) return jsonError('The test email could not be sent. Check the email configuration.', 502);
    return jsonOk({ success: true, data: { sentTo: to } });
  } catch {
    return serverError();
  }
};
