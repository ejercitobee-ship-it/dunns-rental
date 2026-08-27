import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../lib/session';
import { ensureProspectiveFolder, copyDriveFile, DriveNotConnected } from '../../lib/google';
import { getProspective } from '../../lib/prospective';
import { sendEmail } from '../../lib/email';

/**
 * POST /api/document-templates/send-batch
 * Body: { templateIds: string[], prospectiveTenantId: string }
 *
 * Sends multiple templates to a prospective tenant in one action.
 * Each template file is copied to Drive, a document row is created,
 * and a single email lists all the documents sent.
 */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requirePermission(env, request, 'tenants_edit');
  if (auth instanceof Response) return auth;
  try {
    const body = (await request.json()) as { templateIds: string[]; prospectiveTenantId: string };
    const { templateIds, prospectiveTenantId } = body;
    if (!prospectiveTenantId) return jsonError('prospectiveTenantId is required', 400);
    if (!templateIds?.length) return jsonError('At least one template is required', 400);
    if (templateIds.length > 10) return jsonError('Maximum 10 templates at once', 400);

    const applicant = await getProspective(env, prospectiveTenantId);
    if (!applicant) return jsonError('Prospective tenant not found', 404);

    // Load all requested templates.
    const placeholders = templateIds.map(() => '?').join(',');
    const { results: templates } = await env.DB.prepare(
      `SELECT * FROM document_templates WHERE id IN (${placeholders})`
    ).bind(...templateIds).all();
    if (!templates?.length) return jsonError('No matching templates found', 404);

    const who = `${applicant.first_name} ${applicant.last_name}`.trim();
    const folderId = await ensureProspectiveFolder(env);
    const sent: { documentId: string; templateName: string }[] = [];

    for (const tpl of templates) {
      const copyName = `${who} - ${tpl.name as string}`;
      const copiedFileId = await copyDriveFile(
        env,
        tpl.drive_file_id as string,
        copyName,
        folderId,
      );

      const docId = crypto.randomUUID();
      await env.DB.prepare(
        `INSERT INTO documents (id, name, drive_file_id, content_type, size, prospective_tenant_id, uploaded_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        docId,
        tpl.name as string,
        copiedFileId,
        tpl.content_type ?? null,
        tpl.size ?? 0,
        prospectiveTenantId,
        auth.id,
      ).run();

      sent.push({ documentId: docId, templateName: tpl.name as string });
    }

    // Auto-advance from "applied" to "docs_sent".
    if ((applicant.status as string) === 'applied') {
      await env.DB.prepare(
        'UPDATE prospective_tenants SET status = ?, updated_at = unixepoch() WHERE id = ?'
      ).bind('docs_sent', prospectiveTenantId).run();
    }

    // Send a single email listing all documents.
    const email = (applicant.email as string) || '';
    if (email) {
      const firstName = (applicant.first_name as string) || '';
      const greeting = firstName ? `Hi ${firstName},` : 'Hi,';
      const docList = sent.map(s => `  • ${s.templateName}`).join('\n');
      const htmlList = sent.map(s => `<li style="margin:4px 0;">${s.templateName}</li>`).join('');

      context.waitUntil(
        sendEmail(env, {
          to: email,
          subject: `Documents from MH Dunn Property`,
          text: [
            greeting,
            '',
            'We have sent you the following documents:',
            docList,
            '',
            'You will receive a secure link shortly to review and sign your documents. No account or password is needed.',
            '',
            'If you have any questions, just reply to this email or call the office.',
            '',
            'The MH Dunn Property Team',
          ].join('\n'),
          html: `
          <div style="background:#f6f5f1;padding:32px 16px;font-family:'Hanken Grotesk',Helvetica,Arial,sans-serif;color:#1b1a17;">
            <div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e7e4dd;border-radius:12px;padding:32px;">
              <div style="font-family:Georgia,serif;font-size:20px;color:#1b1a17;margin-bottom:24px;">MH Dunn Property</div>
              <p style="margin:0 0 16px;font-size:15px;">${greeting}</p>
              <p style="margin:0 0 16px;font-size:15px;line-height:1.55;">
                We have sent you the following documents:
              </p>
              <ul style="margin:0 0 16px;padding:0 0 0 20px;font-size:15px;line-height:1.55;">
                ${htmlList}
              </ul>
              <p style="margin:0 0 16px;font-size:15px;line-height:1.55;">
                You will receive a secure link shortly to review and sign your documents. No account or password is needed.
              </p>
              <p style="margin:24px 0 0;font-size:13px;color:#6b6966;">
                If you have any questions, just reply to this email or call the office.
              </p>
              <p style="margin:8px 0 0;font-size:13px;color:#6b6966;">The MH Dunn Property Team</p>
            </div>
          </div>`,
        }).catch(e => console.error('batch template send email failed', e))
      );
    }

    return jsonOk({
      success: true,
      data: {
        sent,
        emailed: !!email,
        statusAdvanced: (applicant.status as string) === 'applied',
      },
    });
  } catch (err) {
    if (err instanceof DriveNotConnected) return jsonError('Google Drive is not connected. Connect it in Settings.', 503);
    return serverError();
  }
};
