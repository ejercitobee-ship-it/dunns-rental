import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requireUser, jsonError, serverError } from '../../../lib/session';
import { reachableTenantIds, serverToday } from '../../../lib/portal';
import { getDriveFileStream, DriveNotConnected } from '../../../lib/google';

/**
 * GET /api/portal/documents/:id — stream a document the caller may reach.
 *
 * The document row is fetched by its own id first, but no byte is returned
 * until ITS tenant_id is checked against the caller's session-derived
 * reachable set. A document belonging to anyone else is a 404, not a 403,
 * so the endpoint never confirms that some other tenant's document exists
 * (a 403 would do exactly that).
 */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requireUser(env, request);
  if (auth instanceof Response) return auth;

  try {
    const meta = await env.DB.prepare('SELECT * FROM documents WHERE id = ?')
      .bind(params.id as string)
      .first<{ drive_file_id: string; name: string; content_type: string | null; tenant_id: string | null }>();
    if (!meta) return jsonError('Document not found', 404);

    const reachable = await reachableTenantIds(env, auth, serverToday());
    if (!meta.tenant_id || !reachable.includes(meta.tenant_id)) {
      return jsonError('Document not found', 404);
    }

    const upstream = await getDriveFileStream(env, meta.drive_file_id);
    if (!upstream.ok) return jsonError('Document not found', 404);

    // attachment + an encoded filename, matching the staff endpoint. The name is
    // user supplied, so an unencoded one is header injection. no-store because
    // these are tenants' personal documents and must not sit in a cache.
    return new Response(upstream.body, {
      headers: {
        'Content-Type': meta.content_type || 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(meta.name)}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (err) {
    // Never forward err.message: it can carry Drive internals. DriveNotConnected
    // gets its own friendly wording; anything else is an opaque 500.
    if (err instanceof DriveNotConnected) {
      return jsonError('Google Drive is not connected. Connect it in Settings.', 503);
    }
    return serverError();
  }
};
