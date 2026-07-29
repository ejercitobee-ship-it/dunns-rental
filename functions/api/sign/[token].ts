import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, jsonOk, jsonError, serverError } from '../../lib/session';
import { getProspectiveByToken } from '../../lib/prospective';

/**
 * GET /api/sign/:token — PUBLIC (no login). Returns just what the signing page
 * needs: the applicant's first name, their stage, and the documents to sign.
 * The token is an unguessable UUID; nothing else identifying is exposed.
 */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, params } = context;
  try {
    const applicant = await getProspectiveByToken(env, params.token as string);
    if (!applicant) return jsonError('This link is not valid or has expired.', 404);

    const { results } = await env.DB.prepare(
      'SELECT id, name FROM documents WHERE prospective_tenant_id = ? ORDER BY created_at'
    ).bind(applicant.id).all<{ id: string; name: string }>();

    return jsonOk({
      success: true,
      data: {
        firstName: applicant.first_name,
        status: applicant.status,
        documents: (results || []).map(r => ({ id: r.id, name: r.name })),
      },
    });
  } catch {
    return serverError();
  }
};
