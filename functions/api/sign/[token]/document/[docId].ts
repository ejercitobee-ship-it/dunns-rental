import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, jsonError, serverError } from '../../../../lib/session';
import { getProspectiveByToken } from '../../../../lib/prospective';
import { getDriveFileStream, DriveNotConnected } from '../../../../lib/google';

/**
 * GET /api/sign/:token/document/:docId — PUBLIC. Streams a document for the
 * applicant to view/print, but ONLY a document that belongs to the applicant
 * that token identifies. Inline so it opens in the browser.
 */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, params } = context;
  try {
    const applicant = await getProspectiveByToken(env, params.token as string);
    if (!applicant) return jsonError('This link is not valid.', 404);

    const doc = await env.DB.prepare(
      'SELECT name, drive_file_id, content_type, prospective_tenant_id FROM documents WHERE id = ?'
    ).bind(params.docId as string).first<{ name: string; drive_file_id: string; content_type: string | null; prospective_tenant_id: string | null }>();
    if (!doc || doc.prospective_tenant_id !== applicant.id) return jsonError('Document not found', 404);

    const upstream = await getDriveFileStream(env, doc.drive_file_id);
    if (!upstream.ok) return jsonError('Document not found', 404);

    const headers = new Headers();
    headers.set('Content-Type', doc.content_type || 'application/octet-stream');
    headers.set('Content-Disposition', `inline; filename="${encodeURIComponent(doc.name)}"`);
    headers.set('Cache-Control', 'private, no-store');
    return new Response(upstream.body, { headers });
  } catch (err) {
    if (err instanceof DriveNotConnected) return jsonError('Documents are unavailable right now.', 503);
    return serverError();
  }
};
