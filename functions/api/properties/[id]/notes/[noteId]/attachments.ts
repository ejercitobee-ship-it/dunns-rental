import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../../../../lib/session';
import { ensurePropertyFolder, ensureRootFolder, uploadToDrive, findFolder, createFolder, DriveNotConnected } from '../../../../../lib/google';

const MAX_BYTES = 15 * 1024 * 1024; // 15 MB

/**
 * POST /api/properties/:id/notes/:noteId/attachments — upload a file attachment.
 * Stored in Drive under the property's folder in a "Notes" subfolder.
 */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'properties_edit');
  if (auth instanceof Response) return auth;

  try {
    const propertyId = params.id as string;
    const noteId = params.noteId as string;

    // Verify the note exists
    const note = await env.DB.prepare(
      'SELECT id, title FROM property_notes WHERE id = ? AND property_id = ?'
    ).bind(noteId, propertyId).first<{ id: string; title: string }>();
    if (!note) return jsonError('Note not found', 404);

    const form = await request.formData();
    const file = form.get('file') as unknown as File | null;
    if (!file || typeof file.arrayBuffer !== 'function') return jsonError('No file provided', 400);
    if (file.size > MAX_BYTES) return jsonError('File is too large (max 15 MB)', 413);

    // Upload to Drive: Property > Notes subfolder
    const propFolder = await ensurePropertyFolder(env, propertyId) ?? await ensureRootFolder(env);
    const notesFolder = (await findFolder(env, 'Notes', propFolder)) ?? (await createFolder(env, 'Notes', propFolder));
    const label = `${note.title.slice(0, 40)} - ${file.name}`;
    const uploaded = await uploadToDrive(env, notesFolder, label, file.type || 'application/octet-stream', file);

    // Record the attachment
    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO property_note_attachments
       (id, note_id, name, drive_file_id, content_type, size, uploaded_by, uploaded_by_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, noteId, file.name, uploaded.id, file.type || null, file.size, auth.id, auth.name).run();

    return jsonOk({
      success: true,
      data: {
        id,
        name: file.name,
        driveFileId: uploaded.id,
        contentType: file.type || null,
        size: file.size,
        uploadedBy: auth.id,
        uploadedByName: auth.name,
        uploadedAt: Math.floor(Date.now() / 1000),
      },
    }, 201);
  } catch (err) {
    if (err instanceof DriveNotConnected) {
      return jsonError('Google Drive is not connected. Connect it in Settings.', 503);
    }
    console.error('Note attachment upload error:', err);
    return serverError();
  }
};

/**
 * DELETE /api/properties/:id/notes/:noteId/attachments?attachmentId=xxx
 * Remove an attachment record. The Drive file is left in place.
 */
export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'properties_edit');
  if (auth instanceof Response) return auth;

  try {
    const noteId = params.noteId as string;
    const url = new URL(request.url);
    const attachmentId = url.searchParams.get('attachmentId');
    if (!attachmentId) return jsonError('attachmentId query parameter required', 400);

    const existing = await env.DB.prepare(
      'SELECT id FROM property_note_attachments WHERE id = ? AND note_id = ?'
    ).bind(attachmentId, noteId).first();
    if (!existing) return jsonError('Attachment not found', 404);

    // Only the uploader or super_admin can remove
    const att = await env.DB.prepare('SELECT uploaded_by FROM property_note_attachments WHERE id = ?')
      .bind(attachmentId).first<{ uploaded_by: string | null }>();
    if (auth.role !== 'super_admin' && att?.uploaded_by !== auth.id) {
      return jsonError('Only the uploader or a super admin can remove attachments', 403);
    }

    await env.DB.prepare('DELETE FROM property_note_attachments WHERE id = ?').bind(attachmentId).run();
    return jsonOk({ success: true });
  } catch {
    return serverError();
  }
};
