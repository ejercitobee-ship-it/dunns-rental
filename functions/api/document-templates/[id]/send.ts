import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../../lib/session';
import { ensureProspectiveFolder, copyDriveFile, DriveNotConnected } from '../../../lib/google';
import { getProspective } from '../../../lib/prospective';
import { sendEmail } from '../../../lib/email';

/**
 * POST /api/document-templates/:id/send
 * Body: { prospectiveTenantId: string }
 *
 * Copies the template file into the Prospective Tenants Drive folder (named
 * with the applicant's name), creates a document row linked to the applicant,
 * auto-advances their status to "docs_sent" if still "applied", and emails
 * the applicant a notification (if they have an email on file).
 */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'tenants_edit');
  if (auth instanceof Response) return auth;
  try {
    const templateId = params.id as string;
    const body = (await request.json()) as { prospectiveTenantId: string };
    const ptId = body.prospectiveTenantId;
    if (!ptId) return jsonError('prospectiveTenantId is required', 400);

    // Load template and applicant.
    const template = await env.DB.prepare(
      'SELECT * FROM document_templates WHERE id = ?'
    ).bind(templateId).first();
    if (!template) return jsonError('Template not found', 404);

    const applicant = await getProspective(env, ptId);
    if (!applicant) return jsonError('Prospective tenant not found', 404);

    const who = `${applicant.first_name} ${applicant.last_name}`.trim();
    const folderId = await ensureProspectiveFolder(env);

    // Copy the Drive file so the applicant gets their own copy.
    const copyName = `${who} - ${template.name as string}`;
    const copiedFileId = await copyDriveFile(
      env,
      template.drive_file_id as string,
      copyName,
      folderId,
    );

    // Create a document row linked to this prospective tenant.
    const docId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO documents (id, name, drive_file_id, content_type, size, prospective_tenant_id, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      docId,
      template.name as string,
      copiedFileId,
      template.content_type ?? null,
      template.size ?? 0,
      ptId,
      auth.id,
    ).run();

    // Auto-advance from "applied" to "docs_sent".
    if ((applicant.status as string) === 'applied') {
      await env.DB.prepare(
        'UPDATE prospective_tenants SET status = ?, updated_at = unixepoch() WHERE id = ?'
      ).bind('docs_sent', ptId).run();
    }

    // Email the applicant if they have an address on file.
    const email = (applicant.email as string) || '';
    if (email) {
      const firstName = (applicant.first_name as string) || '';
      const greeting = firstName ? `Hi ${firstName},` : 'Hi,';
      const templateName = template.name as string;
      context.waitUntil(
        sendEmail(env, {
          to: email,
          subject: `New document from MH Dunn Property: ${templateName}`,
          text: [
            greeting,
            '',
            `We have sent you a new document: ${templateName}.`,
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
                We have sent you a new document: <strong>${templateName}</strong>.
              </p>
              <p style="margin:0 0 16px;font-size:15px;line-height:1.55;">
                You will receive a secure link shortly to review and sign your documents. No account or password is needed.
              </p>
              <p style="margin:24px 0 0;font-size:13px;color:#6b6966;">
                If you have any questions, just reply to this email or call the office.
              </p>
              <p style="margin:8px 0 0;font-size:13px;color:#6b6966;">The MH Dunn Property Team</p>
            </div>
          </div>`,
        }).catch(e => console.error('template send email failed', e))
      );
    }

    return jsonOk({
      success: true,
      data: {
        documentId: docId,
        driveFileId: copiedFileId,
        emailed: !!email,
        statusAdvanced: (applicant.status as string) === 'applied',
      },
    });
  } catch (err) {
    if (err instanceof DriveNotConnected) return jsonError('Google Drive is not connected. Connect it in Settings.', 503);
    return serverError();
  }
};
