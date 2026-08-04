import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../../../../lib/session';

/**
 * POST /api/properties/:id/notes/:noteId/pin — toggle pinned status.
 * Admin or super_admin only.
 */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'properties_edit');
  if (auth instanceof Response) return auth;

  if (auth.role !== 'super_admin' && auth.role !== 'admin') {
    return jsonError('Only admins can pin notes', 403);
  }

  try {
    const noteId = params.noteId as string;
    const propertyId = params.id as string;

    const note = await env.DB.prepare(
      'SELECT is_pinned FROM property_notes WHERE id = ? AND property_id = ?'
    ).bind(noteId, propertyId).first<{ is_pinned: number }>();
    if (!note) return jsonError('Note not found', 404);

    const newPinned = note.is_pinned ? 0 : 1;
    await env.DB.prepare(
      'UPDATE property_notes SET is_pinned = ?, updated_at = unixepoch() WHERE id = ?'
    ).bind(newPinned, noteId).run();

    return jsonOk({ success: true, isPinned: !!newPinned });
  } catch {
    return serverError();
  }
};
