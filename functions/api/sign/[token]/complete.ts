import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, jsonOk, jsonError, serverError } from '../../../lib/session';
import { getProspectiveByToken } from '../../../lib/prospective';
import { notifyOffice } from '../../../lib/maintenance-notify';
import { officeUserIds } from '../../../lib/messages';
import { sendPushToUser } from '../../../lib/push';
import { SITE_URL } from '../../../lib/site';

/**
 * POST /api/sign/:token/complete — PUBLIC. The applicant confirms they have
 * uploaded everything. Moves them to "signed" and notifies the office (email +
 * push) so they can review and convert.
 */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, params } = context;
  try {
    const applicant = await getProspectiveByToken(env, params.token as string);
    if (!applicant) return jsonError('This link is not valid or has expired.', 404);
    if (applicant.status === 'converted') return jsonError('This application is already complete.', 400);

    await env.DB.prepare(
      `UPDATE prospective_tenants SET status = 'signed', updated_at = unixepoch() WHERE id = ?`
    ).bind(applicant.id).run();

    const name = `${applicant.first_name} ${applicant.last_name}`.trim();
    context.waitUntil((async () => {
      try {
        await notifyOffice(env, `${name} has signed their documents`, [
          ['Applicant', name],
          ['Next step', 'Review their files and convert them to a tenant.'],
        ]);
        for (const uid of await officeUserIds(env)) {
          await sendPushToUser(env, uid, {
            title: 'Application signed',
            body: `${name} has signed and submitted their documents.`,
            url: `${SITE_URL}/prospective/${applicant.id}`,
          });
        }
      } catch (e) {
        console.error('sign complete notify failed', e);
      }
    })());

    return jsonOk({ success: true });
  } catch {
    return serverError();
  }
};
