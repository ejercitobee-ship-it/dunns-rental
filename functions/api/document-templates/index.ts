import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../lib/session';
import { serializeDocumentTemplate } from '../../lib/serializers';
import { ensureTemplatesFolder, uploadToDrive, DriveNotConnected } from '../../lib/google';

const MAX_BYTES = 15 * 1024 * 1024; // 15 MB

/** GET /api/document-templates — list all templates. */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requirePermission(env, request, 'documents_upload');
  if (auth instanceof Response) return auth;
  try {
    const { results } = await env.DB.prepare(
      'SELECT * FROM document_templates ORDER BY category, name'
    ).all();
    return jsonOk({
      success: true,
      data: (results || []).map(r => serializeDocumentTemplate(r as Record<string, unknown>)),
    });
  } catch {
    return serverError();
  }
};

/** POST /api/document-templates — upload a new template file. */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requirePermission(env, request, 'documents_upload');
  if (auth instanceof Response) return auth;
  try {
    const form = await request.formData();
    const file = form.get('file') as unknown as File | null;
    const name = (form.get('name') as string | null)?.trim();
    const category = (form.get('category') as string | null)?.trim() || 'other';
    const description = (form.get('description') as string | null)?.trim() || null;

    if (!file || typeof file.arrayBuffer !== 'function') return jsonError('No file provided', 400);
    if (file.size > MAX_BYTES) return jsonError('File is too large (max 15 MB)', 413);
    if (!name) return jsonError('Template name is required', 400);

    const validCategories = ['lease', 'application', 'rules', 'addendum', 'other'];
    if (!validCategories.includes(category)) return jsonError('Invalid category', 400);

    const folderId = await ensureTemplatesFolder(env);
    const uploaded = await uploadToDrive(env, folderId, `${name} - ${file.name}`, file.type || 'application/octet-stream', file);

    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO document_templates (id, name, category, description, drive_file_id, content_type, size, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, name, category, description, uploaded.id, file.type || null, file.size, auth.id).run();

    const row = await env.DB.prepare('SELECT * FROM document_templates WHERE id = ?').bind(id).first();
    return jsonOk({ success: true, data: serializeDocumentTemplate(row as Record<string, unknown>) }, 201);
  } catch (err) {
    if (err instanceof DriveNotConnected) return jsonError('Google Drive is not connected. Connect it in Settings.', 503);
    return serverError();
  }
};
