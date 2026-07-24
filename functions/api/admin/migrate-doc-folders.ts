import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, getSessionUser, jsonOk, jsonError, forbidden, unauthorized, serverError } from '../../lib/session';
import { migrateDocumentFoldersToUnits, isDriveConnected, DriveNotConnected } from '../../lib/google';

/**
 * POST /api/admin/migrate-doc-folders — one-time reorg (super admin only).
 * Moves every existing document into its tenant's UNIT folder and retires the
 * old per-person folders. Idempotent and best-effort, so re-running is safe.
 */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const user = await getSessionUser(env, request);
  if (!user) return unauthorized();
  if (user.role !== 'super_admin') return forbidden();

  try {
    if (!(await isDriveConnected(env))) {
      return jsonError('Google Drive is not connected. Connect it in Settings first.', 503);
    }
    const result = await migrateDocumentFoldersToUnits(env);
    return jsonOk({ success: true, data: result });
  } catch (err) {
    if (err instanceof DriveNotConnected) {
      return jsonError('Google Drive is not connected. Connect it in Settings first.', 503);
    }
    return serverError();
  }
};
