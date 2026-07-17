import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonError, jsonOk, serverError } from '../../lib/session';
import { getDriveFileStream, deleteDriveFile, DriveNotConnected } from '../../lib/google';

// GET /api/documents/:id — stream the file back for download.
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'tenants_view');
  if (auth instanceof Response) return auth;

  try {
    const meta = await env.DB.prepare('SELECT * FROM documents WHERE id = ?')
      .bind(params.id as string)
      .first<{ name: string; drive_file_id: string; content_type: string | null }>();
    if (!meta) return jsonError('Document not found', 404);

    const upstream = await getDriveFileStream(env, meta.drive_file_id);
    if (!upstream.ok) return jsonError('Document not found', 404);

    const headers = new Headers();
    headers.set('Content-Type', meta.content_type || 'application/octet-stream');
    headers.set('Content-Disposition', `attachment; filename="${encodeURIComponent(meta.name)}"`);
    headers.set('Cache-Control', 'private, no-store');
    return new Response(upstream.body, { headers });
  } catch (err) {
    // Never forward err.message: it can carry Drive internals. DriveNotConnected
    // gets its own friendly wording; anything else is an opaque 500.
    if (err instanceof DriveNotConnected) {
      return jsonError('Google Drive is not connected. Connect it in Settings.', 503);
    }
    return serverError();
  }
};

// DELETE /api/documents/:id — trash the file in Drive, then remove the row.
export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'tenants_edit');
  if (auth instanceof Response) return auth;

  try {
    const meta = await env.DB.prepare('SELECT drive_file_id FROM documents WHERE id = ?')
      .bind(params.id as string)
      .first<{ drive_file_id: string }>();
    if (!meta) return jsonError('Document not found', 404);

    try {
      await deleteDriveFile(env, meta.drive_file_id);
    } catch (err) {
      // If Drive is not connected, we still remove the row rather than stranding
      // it: the user asked to delete this document, and leaving an
      // undeletable, unusable row behind (pointing at a file we can no longer
      // reach) is worse than a Drive file that outlives its database record.
      // Any other Drive error (a real API failure, not "not connected") should
      // still fail the request, so only DriveNotConnected is swallowed here.
      if (!(err instanceof DriveNotConnected)) throw err;
    }

    await env.DB.prepare('DELETE FROM documents WHERE id = ?').bind(params.id as string).run();
    return jsonOk({ success: true });
  } catch (err) {
    if (err instanceof DriveNotConnected) {
      return jsonError('Google Drive is not connected. Connect it in Settings.', 503);
    }
    return serverError();
  }
};
