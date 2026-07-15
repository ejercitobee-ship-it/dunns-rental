import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../lib/session';

const MAX_BYTES = 15 * 1024 * 1024; // 15 MB

function serializeDoc(r: Record<string, unknown>) {
  return {
    id: r.id,
    name: r.name,
    contentType: r.content_type ?? undefined,
    size: r.size ?? 0,
    propertyId: r.property_id ?? undefined,
    tenantId: r.tenant_id ?? undefined,
    createdAt: r.created_at,
  };
}

// GET /api/documents?tenantId=...&propertyId=...  — list document metadata.
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requirePermission(env, request, 'tenants_view');
  if (auth instanceof Response) return auth;

  try {
    const url = new URL(request.url);
    const tenantId = url.searchParams.get('tenantId');
    const propertyId = url.searchParams.get('propertyId');

    let query = 'SELECT * FROM documents';
    const binds: unknown[] = [];
    if (tenantId) {
      query += ' WHERE tenant_id = ?';
      binds.push(tenantId);
    } else if (propertyId) {
      query += ' WHERE property_id = ?';
      binds.push(propertyId);
    }
    query += ' ORDER BY created_at DESC';

    const { results } = await env.DB.prepare(query).bind(...binds).all();
    return jsonOk({ success: true, data: (results || []).map(serializeDoc) });
  } catch {
    return serverError();
  }
};

// POST /api/documents — multipart upload (file + optional tenantId/propertyId).
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requirePermission(env, request, 'tenants_edit');
  if (auth instanceof Response) return auth;

  if (!env.DOCS) {
    return jsonError('Document storage is not configured. Create the R2 bucket and bind it as DOCS.', 503);
  }

  try {
    const form = await request.formData();
    const file = form.get('file') as unknown as File | null;
    if (!file || typeof file.arrayBuffer !== 'function') {
      return jsonError('No file provided', 400);
    }
    if (file.size > MAX_BYTES) {
      return jsonError('File is too large (max 15 MB)', 413);
    }

    const tenantId = (form.get('tenantId') as string) || null;
    const propertyId = (form.get('propertyId') as string) || null;

    const id = crypto.randomUUID();
    const safeName = file.name.replace(/[^\w.\-]+/g, '_');
    const key = `docs/${tenantId || propertyId || 'general'}/${id}-${safeName}`;

    await env.DOCS.put(key, file.stream(), {
      httpMetadata: { contentType: file.type || 'application/octet-stream' },
    });

    await env.DB.prepare(
      `INSERT INTO documents (id, name, r2_key, content_type, size, property_id, tenant_id, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(id, file.name, key, file.type || null, file.size, propertyId, tenantId, auth.id)
      .run();

    const row = await env.DB.prepare('SELECT * FROM documents WHERE id = ?').bind(id).first();
    return jsonOk({ success: true, data: serializeDoc(row as Record<string, unknown>) }, 201);
  } catch {
    return serverError();
  }
};
