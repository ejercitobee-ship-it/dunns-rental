import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonError, serverError } from '../../lib/session';
import { getDriveFileStream, DriveNotConnected } from '../../lib/google';

/**
 * GET /api/drive/:fileId — stream a Google Drive file by its drive_file_id.
 *
 * Used for files stored directly in Drive (maintenance invoices, property note
 * attachments, expense receipts) that don't have a row in the `documents`
 * table.  PDFs and images are served inline so the browser can preview them;
 * everything else triggers a download.
 */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  // These are management-only files (maintenance invoices, property note
  // attachments, expense receipts). 'dashboard_view' is held by every
  // management role and by no portal role, so this both restores intended staff
  // access and keeps tenants/realtors/handymen out. ('maintenance_view', used
  // previously, is not a defined permission, so the route was unintentionally
  // super_admin-only.)
  const auth = await requirePermission(env, request, 'dashboard_view');
  if (auth instanceof Response) return auth;

  try {
    const fileId = params.fileId as string;
    const upstream = await getDriveFileStream(env, fileId);
    if (!upstream.ok) return jsonError('File not found', 404);

    const ct = upstream.headers.get('Content-Type') || 'application/octet-stream';
    const previewable = ct === 'application/pdf' || ct.startsWith('image/');
    const disp = previewable ? 'inline' : 'attachment';

    return new Response(upstream.body, {
      headers: {
        'Content-Type': ct,
        'Content-Disposition': `${disp}; filename="${encodeURIComponent(fileId)}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (err) {
    if (err instanceof DriveNotConnected) {
      return jsonError('Google Drive is not connected. Connect it in Settings.', 503);
    }
    return serverError();
  }
};
