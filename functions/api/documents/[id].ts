import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonError, jsonOk, serverError } from '../../lib/session';

// GET /api/documents/:id — stream the file back for download.
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'tenants_view');
  if (auth instanceof Response) return auth;

  if (!env.DOCS) return jsonError('Document storage is not configured', 503);

  try {
    const meta = await env.DB.prepare('SELECT * FROM documents WHERE id = ?')
      .bind(params.id as string)
      .first<{ name: string; r2_key: string; content_type: string | null }>();
    if (!meta) return jsonError('Document not found', 404);

    const object = await env.DOCS.get(meta.r2_key);
    if (!object) return jsonError('File missing from storage', 404);

    const headers = new Headers();
    headers.set('Content-Type', meta.content_type || 'application/octet-stream');
    headers.set('Content-Disposition', `attachment; filename="${encodeURIComponent(meta.name)}"`);
    headers.set('Cache-Control', 'private, no-store');
    return new Response(object.body as unknown as BodyInit, { headers });
  } catch {
    return serverError();
  }
};

// DELETE /api/documents/:id — remove from R2 and the metadata table.
export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'tenants_edit');
  if (auth instanceof Response) return auth;

  try {
    const meta = await env.DB.prepare('SELECT r2_key FROM documents WHERE id = ?')
      .bind(params.id as string)
      .first<{ r2_key: string }>();
    if (!meta) return jsonError('Document not found', 404);

    if (env.DOCS) {
      await env.DOCS.delete(meta.r2_key);
    }
    await env.DB.prepare('DELETE FROM documents WHERE id = ?').bind(params.id as string).run();
    return jsonOk({ success: true });
  } catch {
    return serverError();
  }
};
