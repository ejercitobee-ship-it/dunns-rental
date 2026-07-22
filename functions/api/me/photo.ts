import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requireUser, jsonOk, jsonError, serverError } from '../../lib/session';
import { validatePhotoFile } from '../../lib/photos';
import { saveProfilePhoto, removeProfilePhoto, DriveNotConnected } from '../../lib/google';

/**
 * POST /api/me/photo — a signed-in user sets their OWN profile photo. Stored in
 * the Profile Photos folder in Drive and kept on their user row, served through
 * /api/photo/:id. Self-scoped (auth.id), so no users_edit permission is needed.
 */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requireUser(env, request);
  if (auth instanceof Response) return auth;

  try {
    const current = await env.DB.prepare('SELECT image FROM user WHERE id = ?')
      .bind(auth.id)
      .first<{ image: string | null }>();

    const form = await request.formData();
    const file = form.get('photo') as unknown as File | null;
    const valid = validatePhotoFile(file);
    if (!valid.ok) return jsonError(valid.error, 400);

    const newId = await saveProfilePhoto(env, file as File, current?.image ?? undefined);
    await env.DB.prepare('UPDATE user SET image = ?, updated_at = unixepoch() WHERE id = ?')
      .bind(newId, auth.id)
      .run();

    return jsonOk({ success: true, data: { photoUrl: `/api/photo/${newId}` } });
  } catch (err) {
    if (err instanceof DriveNotConnected) return jsonError('Google Drive is not connected. Ask the office.', 503);
    return serverError();
  }
};

/** DELETE /api/me/photo — remove the caller's own profile photo. */
export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requireUser(env, request);
  if (auth instanceof Response) return auth;

  try {
    const current = await env.DB.prepare('SELECT image FROM user WHERE id = ?')
      .bind(auth.id)
      .first<{ image: string | null }>();
    if (current?.image) await removeProfilePhoto(env, current.image);
    await env.DB.prepare('UPDATE user SET image = NULL, updated_at = unixepoch() WHERE id = ?')
      .bind(auth.id)
      .run();
    return jsonOk({ success: true });
  } catch (err) {
    if (err instanceof DriveNotConnected) return jsonError('Google Drive is not connected. Ask the office.', 503);
    return serverError();
  }
};
