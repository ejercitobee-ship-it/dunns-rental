import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requireUser, jsonOk, jsonError, serverError } from '../../../../lib/session';
import { tenantIdForUser } from '../../../../lib/portal';
import { validatePhotoFile } from '../../../../lib/photos';
import { saveMaintenancePhoto, DriveNotConnected } from '../../../../lib/google';

/**
 * POST /api/portal/maintenance/:id/photo — a tenant attaches (or replaces) a
 * photo on one of their own maintenance requests. The image is stored in the
 * Maintenance Photos folder in Drive and served through /api/photo/:id. Scoped
 * to the caller's own request, so a tenant can only ever attach to their own.
 */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requireUser(env, request);
  if (auth instanceof Response) return auth;
  if (auth.role !== 'tenant') return jsonError('Not a tenant account', 403);

  try {
    const tenantId = await tenantIdForUser(env, auth.id);
    if (!tenantId) return jsonError('No tenant record is linked to this login', 404);

    const id = params.id as string;
    const row = await env.DB.prepare(
      'SELECT photo_drive_id FROM maintenance_requests WHERE id = ? AND tenant_id = ?'
    )
      .bind(id, tenantId)
      .first<{ photo_drive_id: string | null }>();
    if (!row) return jsonError('Request not found', 404);

    const form = await request.formData();
    const file = form.get('photo') as unknown as File | null;
    const valid = validatePhotoFile(file);
    if (!valid.ok) return jsonError(valid.error, 400);

    const newId = await saveMaintenancePhoto(env, file as File, row.photo_drive_id ?? undefined);
    await env.DB.prepare('UPDATE maintenance_requests SET photo_drive_id = ?, updated_at = unixepoch() WHERE id = ?')
      .bind(newId, id)
      .run();

    return jsonOk({ success: true, data: { photoUrl: `/api/photo/${newId}` } });
  } catch (err) {
    if (err instanceof DriveNotConnected) return jsonError('Google Drive is not connected. Ask the office.', 503);
    return serverError();
  }
};
