import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../../../lib/session';

/**
 * PUT /api/properties/:id/notes/:noteId — update a note.
 */
export const onRequestPut: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'properties_edit');
  if (auth instanceof Response) return auth;

  try {
    const noteId = params.noteId as string;
    const propertyId = params.id as string;

    const existing = await env.DB.prepare(
      'SELECT * FROM property_notes WHERE id = ? AND property_id = ?'
    ).bind(noteId, propertyId).first();
    if (!existing) return jsonError('Note not found', 404);

    const body = (await request.json()) as {
      title?: string;
      content?: string;
      category?: string;
      isPinned?: boolean;
    };

    const VALID_CATEGORIES = [
      'general', 'property_management', 'tenant_communication', 'maintenance',
      'financial', 'inspection', 'legal', 'compliance', 'other',
    ];

    if (body.category && !VALID_CATEGORIES.includes(body.category)) {
      return jsonError('Invalid category', 400);
    }

    const title = body.title?.trim() || existing.title;
    const content = body.content !== undefined ? body.content : existing.content;
    const category = body.category || existing.category;
    // Only super_admin / admin can pin/unpin
    const isPinned = (auth.role === 'super_admin' || auth.role === 'admin')
      ? (body.isPinned !== undefined ? (body.isPinned ? 1 : 0) : existing.is_pinned)
      : existing.is_pinned;

    await env.DB.prepare(
      `UPDATE property_notes
       SET title = ?, content = ?, category = ?, is_pinned = ?,
           updated_at = unixepoch(), updated_by = ?, updated_by_name = ?
       WHERE id = ?`
    ).bind(title, content, category, isPinned, auth.id, auth.name, noteId).run();

    const row = await env.DB.prepare('SELECT * FROM property_notes WHERE id = ?').bind(noteId).first();
    if (!row) return serverError();

    // Fetch attachments
    const { results: attachments } = await env.DB.prepare(
      'SELECT * FROM property_note_attachments WHERE note_id = ? ORDER BY uploaded_at'
    ).bind(noteId).all();

    return jsonOk({
      success: true,
      data: {
        id: (row as Record<string, unknown>).id,
        propertyId: (row as Record<string, unknown>).property_id,
        title: (row as Record<string, unknown>).title,
        content: (row as Record<string, unknown>).content,
        category: (row as Record<string, unknown>).category,
        isPinned: !!(row as Record<string, unknown>).is_pinned,
        createdBy: (row as Record<string, unknown>).created_by,
        createdByName: (row as Record<string, unknown>).created_by_name,
        createdAt: (row as Record<string, unknown>).created_at,
        updatedAt: (row as Record<string, unknown>).updated_at,
        updatedBy: (row as Record<string, unknown>).updated_by,
        updatedByName: (row as Record<string, unknown>).updated_by_name,
        attachments: (attachments || []).map((a: Record<string, unknown>) => ({
          id: a.id, name: a.name, driveFileId: a.drive_file_id,
          contentType: a.content_type, size: a.size,
          uploadedBy: a.uploaded_by, uploadedByName: a.uploaded_by_name,
          uploadedAt: a.uploaded_at,
        })),
      },
    });
  } catch {
    return serverError();
  }
};

/**
 * DELETE /api/properties/:id/notes/:noteId — delete a note and its attachments.
 * Super admin only.
 */
export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'properties_edit');
  if (auth instanceof Response) return auth;

  try {
    const noteId = params.noteId as string;
    const propertyId = params.id as string;

    const existing = await env.DB.prepare(
      'SELECT * FROM property_notes WHERE id = ? AND property_id = ?'
    ).bind(noteId, propertyId).first();
    if (!existing) return jsonError('Note not found', 404);

    // Only the creator or a super_admin can delete
    if (auth.role !== 'super_admin' && (existing as Record<string, unknown>).created_by !== auth.id) {
      return jsonError('Only the note creator or a super admin can delete notes', 403);
    }

    // D1 does not enforce FK cascades; manually delete attachments first
    await env.DB.batch([
      env.DB.prepare('DELETE FROM property_note_attachments WHERE note_id = ?').bind(noteId),
      env.DB.prepare('DELETE FROM property_notes WHERE id = ?').bind(noteId),
    ]);

    return jsonOk({ success: true });
  } catch {
    return serverError();
  }
};
