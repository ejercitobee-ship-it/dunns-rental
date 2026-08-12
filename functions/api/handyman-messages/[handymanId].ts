import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../lib/session';
import { serializeHandymanMessage, notifyHandymanOfReply, handymanContact } from '../../lib/handyman-messages';
import { readMessageInput, MAX_ATTACHMENT_BYTES } from '../../lib/messages';
import { ensureVendorFolder, uploadToDrive, DriveNotConnected } from '../../lib/google';

const MAX_BODY = 4000;

/** GET /api/handyman-messages/:handymanId — the office's thread with one handyman. */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'properties_view');
  if (auth instanceof Response) return auth;

  try {
    const handymanId = params.handymanId as string;
    const who = await handymanContact(env, handymanId);
    if (!who) return jsonError('Handyman not found', 404);

    const { results } = await env.DB.prepare(
      `SELECT m.*, u.name AS sender_name
         FROM handyman_messages m
         LEFT JOIN user u ON u.id = m.sender_user_id
        WHERE m.handyman_id = ?
        ORDER BY m.created_at ASC`
    ).bind(handymanId).all();

    await env.DB.prepare(
      `UPDATE handyman_messages SET read_by_office = 1
        WHERE handyman_id = ? AND sender_role = 'handyman' AND read_by_office = 0`
    ).bind(handymanId).run();

    return jsonOk({
      success: true,
      data: {
        handymanId,
        handymanName: who.name,
        messages: (results || []).map(serializeHandymanMessage),
      },
    });
  } catch {
    return serverError();
  }
};

/** POST /api/handyman-messages/:handymanId — the office messages a handyman. */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'properties_edit');
  if (auth instanceof Response) return auth;

  try {
    const handymanId = params.handymanId as string;
    const who = await handymanContact(env, handymanId);
    if (!who) return jsonError('Handyman not found', 404);

    const { body, file } = await readMessageInput(request);
    if (!body && !file) return jsonError('Please type a message or attach a file.', 400);
    if (body.length > MAX_BODY) return jsonError('That message is too long.', 400);
    if (file && file.size > MAX_ATTACHMENT_BYTES) return jsonError('That file is too large (max 15 MB).', 413);

    let driveId: string | null = null;
    if (file) {
      const folderId = await ensureVendorFolder(env, handymanId);
      if (!folderId) return jsonError('Could not find that vendor folder.', 404);
      const uploaded = await uploadToDrive(env, folderId, file.name, file.type || 'application/octet-stream', file);
      driveId = uploaded.id;
    }

    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO handyman_messages (id, handyman_id, sender_role, sender_user_id, body, attachment_drive_id, attachment_name, attachment_type, read_by_office, read_by_handyman)
       VALUES (?, ?, 'office', ?, ?, ?, ?, ?, 1, 0)`
    ).bind(id, handymanId, auth.id, body, driveId, file?.name ?? null, file?.type ?? null).run();

    context.waitUntil(
      notifyHandymanOfReply(env, handymanId, body || '(sent an attachment)').catch((e) => console.error('notifyHandymanOfReply failed', e))
    );

    const row = await env.DB.prepare(
      `SELECT m.*, u.name AS sender_name FROM handyman_messages m LEFT JOIN user u ON u.id = m.sender_user_id WHERE m.id = ?`
    ).bind(id).first();
    return jsonOk({ success: true, data: serializeHandymanMessage(row as Record<string, unknown>) }, 201);
  } catch (err) {
    if (err instanceof DriveNotConnected) return jsonError('Attachments are unavailable right now. Please try again without the file.', 503);
    return serverError();
  }
};
