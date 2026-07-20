import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../lib/session';
import { serializeDocument } from '../../lib/serializers';
import { ensureTenantFolder, uploadToDrive, DriveNotConnected } from '../../lib/google';

const MAX_BYTES = 15 * 1024 * 1024; // 15 MB

// GET /api/documents?tenantId=...&propertyId=...  — list document metadata.
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requirePermission(env, request, 'tenants_view');
  if (auth instanceof Response) return auth;

  try {
    const url = new URL(request.url);
    const tenantId = url.searchParams.get('tenantId');
    const propertyId = url.searchParams.get('propertyId');

    // Rent receipts are documents too, but they live on the Payments view (a
    // Receipt link per payment), not in the Documents list, so they don't
    // clutter it. Exclude any document referenced as a payment's receipt, AND
    // anything named like an auto-generated receipt (catches leftover copies
    // from a regenerated receipt that are no longer the linked one).
    let query =
      `SELECT * FROM documents
        WHERE name NOT LIKE 'Rent receipt -%'
          AND id NOT IN (SELECT receipt_document_id FROM rent_payments WHERE receipt_document_id IS NOT NULL)`;
    const binds: unknown[] = [];
    if (tenantId) {
      query += ' AND tenant_id = ?';
      binds.push(tenantId);
    } else if (propertyId) {
      query += ' AND property_id = ?';
      binds.push(propertyId);
    }
    query += ' ORDER BY created_at DESC';

    const { results } = await env.DB.prepare(query).bind(...binds).all();
    return jsonOk({ success: true, data: (results || []).map(serializeDocument) });
  } catch {
    return serverError();
  }
};

// POST /api/documents — multipart upload (file + optional tenantId/propertyId).
// Files land in the tenant's Google Drive folder, created on first use.
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requirePermission(env, request, 'tenants_edit');
  if (auth instanceof Response) return auth;

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

    // A document must belong to a tenant, because Drive folders are per tenant.
    // (Behaviour change from the R2 version, which allowed property-only docs.)
    if (!tenantId) return jsonError('A tenant is required', 400);

    const folderId = await ensureTenantFolder(env, tenantId);
    const uploaded = await uploadToDrive(
      env,
      folderId,
      file.name,
      file.type || 'application/octet-stream',
      file
    );

    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO documents (id, name, drive_file_id, content_type, size, property_id, tenant_id, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(id, file.name, uploaded.id, file.type || null, file.size, propertyId, tenantId, auth.id)
      .run();

    const row = await env.DB.prepare('SELECT * FROM documents WHERE id = ?').bind(id).first();
    return jsonOk({ success: true, data: serializeDocument(row as Record<string, unknown>) }, 201);
  } catch (err) {
    // Never forward err.message: it can carry Drive internals (folder ids,
    // tenant names). DriveNotConnected gets its own friendly wording; anything
    // else is an opaque 500.
    if (err instanceof DriveNotConnected) {
      return jsonError('Google Drive is not connected. Connect it in Settings.', 503);
    }
    return serverError();
  }
};
