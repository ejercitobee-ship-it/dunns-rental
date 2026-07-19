import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requireUser, jsonOk, jsonError, serverError } from '../../lib/session';
import { tenantIdForUser } from '../../lib/portal';
import { validatePhotoFile } from '../../lib/photos';
import { saveProfilePhoto, removeProfilePhoto, DriveNotConnected } from '../../lib/google';

// Read the caller's current photo Drive id: tenants from their tenant row,
// realtors from their user row. Returns { column, id, key } to update.
async function currentPhoto(env: Env, auth: { id: string; role: string }) {
  if (auth.role === 'tenant') {
    const tid = await tenantIdForUser(env, auth.id);
    if (!tid) return null;
    const row = await env.DB.prepare('SELECT photo_drive_id FROM tenants WHERE id = ?').bind(tid).first<{ photo_drive_id: string | null }>();
    return { table: 'tenants' as const, recordId: tid, column: 'photo_drive_id', old: row?.photo_drive_id ?? null };
  }
  if (auth.role === 'realtor') {
    const row = await env.DB.prepare('SELECT image FROM user WHERE id = ?').bind(auth.id).first<{ image: string | null }>();
    return { table: 'user' as const, recordId: auth.id, column: 'image', old: row?.image ?? null };
  }
  return null;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requireUser(env, request);
  if (auth instanceof Response) return auth;

  try {
    const target = await currentPhoto(env, auth);
    if (!target) return jsonError('Only a tenant or realtor can set a photo here', 403);

    const form = await request.formData();
    const file = form.get('photo') as unknown as File | null;
    const valid = validatePhotoFile(file);
    if (!valid.ok) return jsonError(valid.error, 400);

    const newId = await saveProfilePhoto(env, file as File, target.old ?? undefined);
    await env.DB.prepare(`UPDATE ${target.table} SET ${target.column} = ? WHERE id = ?`).bind(newId, target.recordId).run();
    return jsonOk({ success: true, data: { photoUrl: `/api/photo/${newId}` } });
  } catch (err) {
    if (err instanceof DriveNotConnected) return jsonError('Google Drive is not connected. Ask the office.', 503);
    return serverError();
  }
};

export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requireUser(env, request);
  if (auth instanceof Response) return auth;

  try {
    const target = await currentPhoto(env, auth);
    if (!target) return jsonError('Only a tenant or realtor can remove a photo here', 403);
    if (target.old) {
      try { await removeProfilePhoto(env, target.old); } catch { /* already gone is fine */ }
    }
    await env.DB.prepare(`UPDATE ${target.table} SET ${target.column} = NULL WHERE id = ?`).bind(target.recordId).run();
    return jsonOk({ success: true });
  } catch {
    return serverError();
  }
};
