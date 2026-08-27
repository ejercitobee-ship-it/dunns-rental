import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../lib/session';
import { serializeDocumentTemplate } from '../../lib/serializers';

/** PUT /api/document-templates/:id — update name, category, or description. */
export const onRequestPut: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'documents_upload');
  if (auth instanceof Response) return auth;
  try {
    const id = params.id as string;
    const existing = await env.DB.prepare('SELECT id FROM document_templates WHERE id = ?').bind(id).first();
    if (!existing) return jsonError('Template not found', 404);

    const body = (await request.json()) as { name?: string; category?: string; description?: string };
    const name = body.name?.trim();
    const category = body.category?.trim();
    const description = body.description?.trim() ?? null;

    if (name !== undefined && !name) return jsonError('Name cannot be empty', 400);
    const validCategories = ['lease', 'application', 'rules', 'addendum', 'other'];
    if (category && !validCategories.includes(category)) return jsonError('Invalid category', 400);

    await env.DB.prepare(
      `UPDATE document_templates SET
        name = COALESCE(?, name),
        category = COALESCE(?, category),
        description = ?,
        updated_at = unixepoch()
       WHERE id = ?`
    ).bind(name ?? null, category ?? null, description, id).run();

    const row = await env.DB.prepare('SELECT * FROM document_templates WHERE id = ?').bind(id).first();
    return jsonOk({ success: true, data: serializeDocumentTemplate(row as Record<string, unknown>) });
  } catch {
    return serverError();
  }
};

/** DELETE /api/document-templates/:id — remove a template record (Drive file retained). */
export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'documents_delete');
  if (auth instanceof Response) return auth;
  try {
    const id = params.id as string;
    const existing = await env.DB.prepare('SELECT id FROM document_templates WHERE id = ?').bind(id).first();
    if (!existing) return jsonError('Template not found', 404);

    await env.DB.prepare('DELETE FROM document_templates WHERE id = ?').bind(id).run();
    return jsonOk({ success: true });
  } catch {
    return serverError();
  }
};
