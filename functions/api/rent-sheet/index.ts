import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, serverError } from '../../lib/session';
import { isDriveConnected } from '../../lib/google';
import { currentRentSheetUrl } from '../../lib/sheets';

// GET /api/rent-sheet — whether Drive is connected and the sheet's URL (if it
// exists yet). Does not create the sheet; the first sync or change creates it.
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requirePermission(env, request, 'finances_view');
  if (auth instanceof Response) return auth;

  try {
    const connected = await isDriveConnected(env);
    const url = connected ? await currentRentSheetUrl(env) : null;
    return jsonOk({ success: true, data: { connected, url } });
  } catch {
    return serverError();
  }
};
