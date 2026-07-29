import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../../lib/session';
import { getProspective } from '../../../lib/prospective';
import { sendEmail, signingLinkEmail } from '../../../lib/email';
import { SITE_URL } from '../../../lib/site';

/**
 * POST /api/prospective-tenants/:id/sign-link — mint (or reuse) a secure, no-
 * login signing token for an applicant and mark them as "docs sent". The office
 * sends the returned link; the applicant opens it to view and upload signed
 * documents without an account.
 */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'tenants_edit');
  if (auth instanceof Response) return auth;

  try {
    const id = params.id as string;
    const applicant = await getProspective(env, id);
    if (!applicant) return jsonError('Applicant not found', 404);
    if (applicant.status === 'converted') return jsonError('This applicant is already a tenant', 400);

    let token = (applicant.sign_token as string) || '';
    if (!token) token = crypto.randomUUID();

    // Sending the link moves an untouched applicant to "docs sent"; a later
    // stage (signed) is left as-is so re-sending does not roll it back.
    const status = applicant.status === 'applied' ? 'docs_sent' : (applicant.status as string);

    await env.DB.prepare(
      'UPDATE prospective_tenants SET sign_token = ?, status = ?, updated_at = unixepoch() WHERE id = ?'
    ).bind(token, status, id).run();

    // Email the applicant the link automatically when they have an email on
    // file. Best-effort: a mail failure never blocks the link being usable.
    const email = (applicant.email as string) || '';
    const url = `${SITE_URL}/sign/${token}`;
    if (email) {
      context.waitUntil(
        sendEmail(env, { to: email, ...signingLinkEmail(url, applicant.first_name as string) })
          .catch((e) => console.error('signing link email failed', e))
      );
    }

    return jsonOk({ success: true, data: { token, emailedTo: email || null } });
  } catch {
    return serverError();
  }
};
