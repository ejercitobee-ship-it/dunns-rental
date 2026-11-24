import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, serverError } from '../../../lib/session';
import { resolveRecipients, type RecipientFilter } from '../../../lib/recipients';

/**
 * POST /api/email/campaigns/resolve — preview the recipients a filter selects.
 * Returns the deduped list (name + email) and the count. The list is derived
 * entirely server-side from the filter; no client-supplied recipient list is
 * trusted.
 */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requirePermission(env, request, 'announcements_send');
  if (auth instanceof Response) return auth;
  try {
    const filter = (await request.json()) as RecipientFilter;
    const recipients = await resolveRecipients(env, filter || {});
    return jsonOk({ success: true, data: { count: recipients.length, recipients } });
  } catch {
    return serverError();
  }
};
