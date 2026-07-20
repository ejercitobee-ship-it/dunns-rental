import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../../lib/session';
import { DriveNotConnected } from '../../../lib/google';
import { generateReceipt } from '../../../lib/receipts';

/**
 * POST /api/payments/:id/receipt — generate (or refresh) the receipt for a
 * paid payment on demand. The "Generate receipt" fallback for a payment that
 * has none yet (recorded while Drive was disconnected, or an older one).
 */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'rents_record');
  if (auth instanceof Response) return auth;

  try {
    const receiptDocumentId = await generateReceipt(env, params.id as string, auth.id);
    if (!receiptDocumentId) {
      return jsonError('This payment cannot be receipted (it must be a paid payment with a tenant on the lease).', 400);
    }
    return jsonOk({ success: true, data: { receiptDocumentId } });
  } catch (err) {
    if (err instanceof DriveNotConnected) {
      return jsonError('Google Drive is not connected. Connect it in Settings to create receipts.', 503);
    }
    return serverError();
  }
};
