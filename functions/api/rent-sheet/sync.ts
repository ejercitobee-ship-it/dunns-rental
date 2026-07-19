import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../lib/session';
import { DriveNotConnected } from '../../lib/google';
import { rebuildRentSheet, rentSheetUrl } from '../../lib/sheets';

// POST /api/rent-sheet/sync — create the sheet if needed and rebuild both tabs
// from the database (the "Sync now" button and the initial backfill).
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requirePermission(env, request, 'finances_view');
  if (auth instanceof Response) return auth;

  try {
    const id = await rebuildRentSheet(env);
    return jsonOk({ success: true, data: { url: rentSheetUrl(id) } });
  } catch (err) {
    if (err instanceof DriveNotConnected) {
      return jsonError('Google Drive is not connected. Connect it in Settings.', 503);
    }
    return serverError();
  }
};
