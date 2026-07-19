import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../../lib/session';
import { validatePhotoFile } from '../../../lib/photos';
import { saveProfilePhoto, removeProfilePhoto, DriveNotConnected } from '../../../lib/google';

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'tenants_edit');
  if (auth instanceof Response) return auth;
  try {
    const id = params.id as string;
    const row = await env.DB.prepare('SELECT photo_drive_id FROM tenants WHERE id = ?').bind(id).first<{ photo_drive_id: string | null }>();
    if (!row) return jsonError('Tenant not found', 404);
    const form = await request.formData();
    const file = form.get('photo') as unknown as File | null;
    const valid = validatePhotoFile(file);
    if (!valid.ok) return jsonError(valid.error, 400);
    const newId = await saveProfilePhoto(env, file as File, row.photo_drive_id ?? undefined);
    await env.DB.prepare('UPDATE tenants SET photo_drive_id = ?, updated_at = unixepoch() WHERE id = ?').bind(newId, id).run();
    return jsonOk({ success: true, data: { photoUrl: `/api/photo/${newId}` } });
  } catch (err) {
    if (err instanceof DriveNotConnected) return jsonError('Google Drive is not connected. Connect it in Settings.', 503);
    return serverError();
  }
};

export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'tenants_edit');
  if (auth instanceof Response) return auth;
  try {
    const id = params.id as string;
    const row = await env.DB.prepare('SELECT photo_drive_id FROM tenants WHERE id = ?').bind(id).first<{ photo_drive_id: string | null }>();
    if (!row) return jsonError('Tenant not found', 404);
    if (row.photo_drive_id) await removeProfilePhoto(env, row.photo_drive_id);
    await env.DB.prepare('UPDATE tenants SET photo_drive_id = NULL, updated_at = unixepoch() WHERE id = ?').bind(id).run();
    return jsonOk({ success: true });
  } catch (err) {
    if (err instanceof DriveNotConnected) return jsonError('Google Drive is not connected. Connect it in Settings.', 503);
    return serverError();
  }
};
