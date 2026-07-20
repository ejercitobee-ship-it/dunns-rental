import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requireUser, jsonOk, jsonError, serverError } from '../../../lib/session';
import { reachableTenantIds, serverToday } from '../../../lib/portal';
import { ensureTenantFolder, uploadToDrive, DriveNotConnected } from '../../../lib/google';
import { serializeDocument } from '../../../lib/serializers';

const MAX_BYTES = 15 * 1024 * 1024; // 15 MB, matching the staff upload endpoint.

/**
 * GET /api/portal/documents?tenantId=...
 *
 * tenantId is optional and is only ever used to narrow WITHIN the caller's
 * reachable set, which is resolved from the session (never from the query
 * string). An id outside that set yields nothing rather than an error, so the
 * endpoint cannot be used to probe which tenants exist.
 */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requireUser(env, request);
  if (auth instanceof Response) return auth;

  try {
    const reachable = await reachableTenantIds(env, auth, serverToday());
    if (reachable.length === 0) return jsonOk({ success: true, data: [] });

    const asked = new URL(request.url).searchParams.get('tenantId');
    const ids = asked ? reachable.filter(id => id === asked) : reachable;
    if (ids.length === 0) return jsonOk({ success: true, data: [] });

    // Rent receipts are excluded here: the tenant gets them on the Payments
    // tab (a Download per paid month), so the Documents tab stays uncluttered.
    const placeholders = ids.map(() => '?').join(',');
    const { results } = await env.DB.prepare(
      `SELECT * FROM documents
        WHERE tenant_id IN (${placeholders})
          AND id NOT IN (SELECT receipt_document_id FROM rent_payments WHERE receipt_document_id IS NOT NULL)
        ORDER BY created_at DESC`
    ).bind(...ids).all();

    return jsonOk({ success: true, data: (results || []).map(serializeDocument) });
  } catch {
    return serverError();
  }
};

/**
 * POST /api/portal/documents — multipart upload for a reachable tenant.
 *
 * A tenant may only upload to themselves; a realtor to a tenant inside their
 * window. Both cases fall out of the reachable set, so there is no separate
 * branch to get wrong: the tenantId in the form is checked against the
 * session-derived reachable set, and rejected with 403 if absent from it.
 *
 * The bytes go to Belle's Google Drive, into the tenant's own folder, exactly
 * as the staff endpoint does. The FILE id Drive returns (not the folder id)
 * is what gets stored in documents.drive_file_id.
 */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requireUser(env, request);
  if (auth instanceof Response) return auth;

  try {
    const form = await request.formData();
    // workers-types' FormData.get() is typed as string | null, which does not
    // reflect the runtime (a file field really is a File). The staff upload
    // endpoint casts through unknown for the same reason; matched here so both
    // endpoints agree on how a missing/non-file field is detected.
    const file = form.get('file') as unknown as File | null;
    const askedTenantId = String(form.get('tenantId') || '');
    if (!file || typeof file.arrayBuffer !== 'function') {
      return jsonError('A file is required', 400);
    }
    if (!askedTenantId) return jsonError('A tenant is required', 400);
    if (file.size > MAX_BYTES) return jsonError('File is too large (max 15 MB)', 413);

    const reachable = await reachableTenantIds(env, auth, serverToday());
    if (!reachable.includes(askedTenantId)) {
      return jsonError('You do not have access to that tenant', 403);
    }

    const folderId = await ensureTenantFolder(env, askedTenantId);
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
    ).bind(id, file.name, uploaded.id, file.type || null, file.size, null, askedTenantId, auth.id).run();

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
