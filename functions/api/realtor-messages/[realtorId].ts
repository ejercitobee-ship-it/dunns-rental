import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../lib/session';
import { serializeRealtorMessage, notifyRealtorOfReply, realtorContact } from '../../lib/realtor-messages';
import { readMessageInput, MAX_ATTACHMENT_BYTES } from '../../lib/messages';
import { ensureRealtorFolder, uploadToDrive, DriveNotConnected } from '../../lib/google';

const MAX_BODY = 4000;

/** GET /api/realtor-messages/:realtorId — the office's thread with one realtor. */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'tenants_view');
  if (auth instanceof Response) return auth;

  try {
    const realtorId = params.realtorId as string;
    const who = await realtorContact(env, realtorId);
    if (!who) return jsonError('Realtor not found', 404);

    const { results } = await env.DB.prepare(
      `SELECT m.*, u.name AS sender_name
         FROM realtor_messages m
         LEFT JOIN user u ON u.id = m.sender_user_id
        WHERE m.realtor_user_id = ?
        ORDER BY m.created_at ASC`
    ).bind(realtorId).all();

    await env.DB.prepare(
      `UPDATE realtor_messages SET read_by_office = 1
        WHERE realtor_user_id = ? AND sender_role = 'realtor' AND read_by_office = 0`
    ).bind(realtorId).run();

    return jsonOk({
      success: true,
      data: {
        realtorId,
        realtorName: who.name,
        messages: (results || []).map(serializeRealtorMessage),
      },
    });
  } catch {
    return serverError();
  }
};

/** POST /api/realtor-messages/:realtorId — the office messages a realtor. */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'tenants_edit');
  if (auth instanceof Response) return auth;

  try {
    const realtorId = params.realtorId as string;
    const who = await realtorContact(env, realtorId);
    if (!who) return jsonError('Realtor not found', 404);

    const { body, file } = await readMessageInput(request);
    if (!body && !file) return jsonError('Please type a message or attach a file.', 400);
    if (body.length > MAX_BODY) return jsonError('That message is too long.', 400);
    if (file && file.size > MAX_ATTACHMENT_BYTES) return jsonError('That file is too large (max 15 MB).', 413);

    let driveId: string | null = null;
    if (file) {
      const folderId = await ensureRealtorFolder(env, realtorId);
      if (!folderId) return jsonError('Could not create the realtor folder.', 500);
      const uploaded = await uploadToDrive(env, folderId, file.name, file.type || 'application/octet-stream', file);
      driveId = uploaded.id;
    }

    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO realtor_messages (id, realtor_user_id, sender_role, sender_user_id, body, attachment_drive_id, attachment_name, attachment_type, read_by_office, read_by_realtor)
       VALUES (?, ?, 'office', ?, ?, ?, ?, ?, 1, 0)`
    ).bind(id, realtorId, auth.id, body, driveId, file?.name ?? null, file?.type ?? null).run();

    context.waitUntil(
      notifyRealtorOfReply(env, realtorId, body || '(sent an attachment)').catch((e) => console.error('notifyRealtorOfReply failed', e))
    );

    const row = await env.DB.prepare(
      `SELECT m.*, u.name AS sender_name FROM realtor_messages m LEFT JOIN user u ON u.id = m.sender_user_id WHERE m.id = ?`
    ).bind(id).first();
    return jsonOk({ success: true, data: serializeRealtorMessage(row as Record<string, unknown>) }, 201);
  } catch (err) {
    if (err instanceof DriveNotConnected) return jsonError('Attachments are unavailable right now. Please try again without the file.', 503);
    return serverError();
  }
};
