import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, jsonOk, jsonError, serverError } from '../../../lib/session';
import { getProspectiveByToken } from '../../../lib/prospective';
import { ensureRootFolder, uploadToDrive, DriveNotConnected } from '../../../lib/google';

const MAX_BYTES = 15 * 1024 * 1024; // 15 MB

/**
 * POST /api/sign/:token/upload — PUBLIC. The applicant uploads a signed copy of
 * a document. Stored in Drive, named to show it is the applicant's signed file,
 * and linked to them via prospective_tenant_id (so the office sees it too).
 */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  try {
    const applicant = await getProspectiveByToken(env, params.token as string);
    if (!applicant) return jsonError('This link is not valid or has expired.', 404);
    if (applicant.status === 'converted') return jsonError('This application is already complete.', 400);

    const form = await request.formData();
    const file = form.get('file') as unknown as File | null;
    if (!file || typeof file.arrayBuffer !== 'function') return jsonError('No file provided', 400);
    if (file.size > MAX_BYTES) return jsonError('File is too large (max 15 MB)', 413);

    const who = `${applicant.first_name} ${applicant.last_name}`.trim();
    const folderId = await ensureRootFolder(env);
    const uploaded = await uploadToDrive(
      env, folderId, `${who} - SIGNED - ${file.name}`, file.type || 'application/octet-stream', file
    );

    const docId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO documents (id, name, drive_file_id, content_type, size, prospective_tenant_id)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(docId, `Signed - ${file.name}`, uploaded.id, file.type || null, file.size, applicant.id).run();

    return jsonOk({ success: true, data: { id: docId, name: `Signed - ${file.name}` } }, 201);
  } catch (err) {
    if (err instanceof DriveNotConnected) return jsonError('Uploads are unavailable right now. Please contact the office.', 503);
    return serverError();
  }
};
