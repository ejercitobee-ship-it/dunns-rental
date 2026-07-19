import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../../../lib/session';
import { validatePhotoFile } from '../../../../lib/photos';
import { saveProfilePhoto, removeProfilePhoto, DriveNotConnected } from '../../../../lib/google';

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'users_edit');
  if (auth instanceof Response) return auth;
  try {
    const id = params.id as string;
    const row = await env.DB.prepare('SELECT image FROM user WHERE id = ?').bind(id).first<{ image: string | null }>();
    if (!row) return jsonError('User not found', 404);
    const form = await request.formData();
    const file = form.get('photo') as unknown as File | null;
    const valid = validatePhotoFile(file);
    if (!valid.ok) return jsonError(valid.error, 400);
    const newId = await saveProfilePhoto(env, file as File, row.image ?? undefined);
    await env.DB.prepare('UPDATE user SET image = ?, updated_at = ? WHERE id = ?').bind(newId, Math.floor(Date.now() / 1000), id).run();
    return jsonOk({ success: true, data: { photoUrl: `/api/photo/${newId}` } });
  } catch (err) {
    if (err instanceof DriveNotConnected) return jsonError('Google Drive is not connected. Connect it in Settings.', 503);
    return serverError();
  }
};

export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'users_edit');
  if (auth instanceof Response) return auth;
  try {
    const id = params.id as string;
    const row = await env.DB.prepare('SELECT image FROM user WHERE id = ?').bind(id).first<{ image: string | null }>();
    if (!row) return jsonError('User not found', 404);
    if (row.image) await removeProfilePhoto(env, row.image);
    await env.DB.prepare('UPDATE user SET image = NULL, updated_at = ? WHERE id = ?').bind(Math.floor(Date.now() / 1000), id).run();
    return jsonOk({ success: true });
  } catch (err) {
    if (err instanceof DriveNotConnected) return jsonError('Google Drive is not connected. Connect it in Settings.', 503);
    return serverError();
  }
};
