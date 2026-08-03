import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requireUser, jsonOk, jsonError, serverError } from '../../../../../lib/session';
import { handymanForUser } from '../../../../../lib/portal';
import { loadOwnedJob, serializeJob } from '../../../../../lib/handyman-jobs';
import { validatePhotoFile } from '../../../../../lib/photos';
import { saveMaintenancePhoto, DriveNotConnected } from '../../../../../lib/google';

/**
 * POST /api/portal/handyman/jobs/:id/photo — a handyman attaches a completion
 * photo (before/after, finished work) to one of their own jobs.
 */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requireUser(env, request);
  if (auth instanceof Response) return auth;
  if (auth.role !== 'handyman') return jsonError('Not a handyman account', 403);

  try {
    const handyman = await handymanForUser(env, auth.id);
    if (!handyman) return jsonError('No active handyman record is linked to this login', 404);

    const jobId = params.id as string;
    const existing = await loadOwnedJob(env, jobId, handyman.id);
    if (!existing) return jsonError('Job not found', 404);

    const form = await request.formData();
    const file = form.get('photo') as unknown as File | null;
    const valid = validatePhotoFile(file);
    if (!valid.ok) return jsonError(valid.error, 400);

    const oldId = existing.completion_photo_drive_id as string | undefined;
    const newId = await saveMaintenancePhoto(env, file as File, oldId || undefined);

    await env.DB.prepare(
      'UPDATE maintenance_requests SET completion_photo_drive_id = ?, updated_at = unixepoch() WHERE id = ? AND assigned_handyman_id = ?'
    ).bind(newId, jobId, handyman.id).run();

    const row = await loadOwnedJob(env, jobId, handyman.id);
    return jsonOk({ success: true, data: row ? serializeJob(row) : null });
  } catch (err) {
    if (err instanceof DriveNotConnected) return jsonError('Google Drive is not connected. Ask the office.', 503);
    return serverError();
  }
};
