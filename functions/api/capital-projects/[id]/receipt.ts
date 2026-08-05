import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../../lib/session';
import { ensurePropertyFolder, findFolder, createFolder, uploadToDrive, DriveNotConnected } from '../../../lib/google';

const MAX_BYTES = 15 * 1024 * 1024;

/**
 * POST /api/capital-projects/:id/receipt — upload a receipt/photo into the
 * project's Drive folder: Property / Capital Improvements / <Project Name> /
 */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'finances_expenses');
  if (auth instanceof Response) return auth;

  try {
    const projectId = params.id as string;
    const project = await env.DB.prepare(
      'SELECT id, name, property_id, drive_folder_id FROM capital_projects WHERE id = ?'
    ).bind(projectId).first<{ id: string; name: string; property_id: string; drive_folder_id: string | null }>();
    if (!project) return jsonError('Project not found', 404);

    const form = await request.formData();
    const file = form.get('file') as unknown as File | null;
    if (!file || typeof file.arrayBuffer !== 'function') return jsonError('No file provided', 400);
    if (file.size > MAX_BYTES) return jsonError('File is too large (max 15 MB)', 413);

    // Ensure Drive folder: Property / Capital Improvements / <Project Name>
    let folderId = project.drive_folder_id;
    if (!folderId) {
      const propFolder = await ensurePropertyFolder(env, project.property_id);
      if (!propFolder) return jsonError('Property Drive folder not available.', 503);
      const capFolder = (await findFolder(env, 'Capital Improvements', propFolder))
        ?? (await createFolder(env, 'Capital Improvements', propFolder));
      folderId = (await findFolder(env, project.name, capFolder))
        ?? (await createFolder(env, project.name, capFolder));
      // Cache the folder id on the project
      await env.DB.prepare('UPDATE capital_projects SET drive_folder_id = ? WHERE id = ?')
        .bind(folderId, projectId).run();
    }

    const label = `${file.name}`;
    const uploaded = await uploadToDrive(env, folderId, label, file.type || 'application/octet-stream', file);

    return jsonOk({ success: true, data: { driveFileId: uploaded.id, name: file.name } });
  } catch (err) {
    if (err instanceof DriveNotConnected) {
      return jsonError('Google Drive is not connected. Connect it in Settings.', 503);
    }
    console.error('Capital project receipt upload error:', err);
    return serverError();
  }
};
