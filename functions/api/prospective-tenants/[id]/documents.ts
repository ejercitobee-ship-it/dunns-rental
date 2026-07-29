import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../../lib/session';
import { serializeDocument } from '../../../lib/serializers';
import { ensureProspectiveFolder, uploadToDrive, DriveNotConnected } from '../../../lib/google';
import { getProspective } from '../../../lib/prospective';

const MAX_BYTES = 15 * 1024 * 1024; // 15 MB

/** GET /api/prospective-tenants/:id/documents — the applicant's files. */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'tenants_view');
  if (auth instanceof Response) return auth;
  try {
    const { results } = await env.DB.prepare(
      'SELECT * FROM documents WHERE prospective_tenant_id = ? ORDER BY created_at DESC'
    ).bind(params.id as string).all();
    // Expose uploadedBy on THIS office-only endpoint (not the shared serializer,
    // which also feeds the tenant portal) so the office can tell a document it
    // sent (has an uploader) from a signed copy the applicant sent back (null).
    return jsonOk({
      success: true,
      data: (results || []).map(r => ({
        ...serializeDocument(r as Record<string, unknown>),
        uploadedBy: (r as Record<string, unknown>).uploaded_by ?? null,
      })),
    });
  } catch {
    return serverError();
  }
};

/**
 * POST /api/prospective-tenants/:id/documents — upload a file (application,
 * lease to sign, etc.) for an applicant. Stored in Drive under the root, named
 * with the applicant so it is findable; linked by prospective_tenant_id.
 */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'tenants_edit');
  if (auth instanceof Response) return auth;
  try {
    const id = params.id as string;
    const applicant = await getProspective(env, id);
    if (!applicant) return jsonError('Applicant not found', 404);

    const form = await request.formData();
    const file = form.get('file') as unknown as File | null;
    if (!file || typeof file.arrayBuffer !== 'function') return jsonError('No file provided', 400);
    if (file.size > MAX_BYTES) return jsonError('File is too large (max 15 MB)', 413);

    const who = `${applicant.first_name} ${applicant.last_name}`.trim();
    const folderId = await ensureProspectiveFolder(env);
    const uploaded = await uploadToDrive(
      env, folderId, `${who} - ${file.name}`, file.type || 'application/octet-stream', file
    );

    const docId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO documents (id, name, drive_file_id, content_type, size, prospective_tenant_id, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(docId, file.name, uploaded.id, file.type || null, file.size, id, auth.id).run();

    const row = await env.DB.prepare('SELECT * FROM documents WHERE id = ?').bind(docId).first();
    return jsonOk({ success: true, data: serializeDocument(row as Record<string, unknown>) }, 201);
  } catch (err) {
    if (err instanceof DriveNotConnected) {
      return jsonError('Google Drive is not connected. Connect it in Settings.', 503);
    }
    return serverError();
  }
};
