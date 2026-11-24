import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../../../lib/session';
import { sendCampaign } from '../../../../lib/campaign-send';
import { logActivityStmt } from '../../../../lib/activity';

/**
 * POST /api/email/campaigns/:id/send — send a draft campaign to its resolved
 * recipients. Idempotent (the campaign is claimed draft->processing), so a
 * repeat call does nothing. Returns immediately; delivery runs in the
 * background and updates the campaign status and per-recipient rows.
 */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'announcements_send');
  if (auth instanceof Response) return auth;

  try {
    const id = params.id as string;
    const result = await sendCampaign(env, id, context.waitUntil.bind(context));
    if (!result.started) {
      if (result.reason === 'not_found') return jsonError('Campaign not found', 404);
      if (result.reason === 'already_sent') return jsonError('This campaign has already been sent', 409);
      if (result.reason === 'no_recipients') return jsonError('No recipients match this campaign', 400);
      return jsonError('The campaign could not be sent', 400);
    }

    const camp = await env.DB.prepare('SELECT name FROM email_campaigns WHERE id = ?').bind(id).first<{ name: string }>();
    context.waitUntil(
      logActivityStmt(env.DB, auth, {
        module: 'tenants',
        action: 'Sent an email campaign',
        description: `"${camp?.name ?? id}" to ${result.recipientCount} recipient${result.recipientCount === 1 ? '' : 's'}`,
        targetType: 'email_campaign',
        targetId: id,
      }).run().then(() => undefined).catch(() => undefined)
    );

    return jsonOk({ success: true, data: { status: 'processing', recipientCount: result.recipientCount } });
  } catch {
    return serverError();
  }
};
