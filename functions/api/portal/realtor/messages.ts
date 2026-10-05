import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requireUser, jsonOk, jsonError, serverError } from '../../../lib/session';
import { serializeRealtorMessage, notifyOfficeOfRealtorMessage } from '../../../lib/realtor-messages';
import { readMessageInput, MAX_ATTACHMENT_BYTES } from '../../../lib/messages';
import { ensureRealtorFolder, uploadToDrive, DriveNotConnected } from '../../../lib/google';

const MAX_BODY = 4000;

/**
 * GET /api/portal/realtor/messages — the realtor's own thread with the office.
 * `?count=1` returns just the unread count (nav badge).
 */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requireUser(env, request);
  if (auth instanceof Response) return auth;
  if (auth.role !== 'realtor') return jsonError('Not a realtor account', 403);

  try {
    const url = new URL(request.url);
    if (url.searchParams.get('count') === '1') {
      const row = await env.DB.prepare(
        `SELECT COUNT(*) AS n FROM realtor_messages
          WHERE realtor_user_id = ? AND sender_role = 'office' AND read_by_realtor = 0`
      ).bind(auth.id).first<{ n: number }>();
      return jsonOk({ success: true, data: { count: row?.n ?? 0 } });
    }

    const { results } = await env.DB.prepare(
      `SELECT m.*, u.name AS sender_name
         FROM realtor_messages m
         LEFT JOIN user u ON u.id = m.sender_user_id
        WHERE m.realtor_user_id = ?
        ORDER BY m.created_at ASC`
    ).bind(auth.id).all();

    await env.DB.prepare(
      `UPDATE realtor_messages SET read_by_realtor = 1
        WHERE realtor_user_id = ? AND sender_role = 'office' AND read_by_realtor = 0`
    ).bind(auth.id).run();

    return jsonOk({ success: true, data: { messages: (results || []).map(serializeRealtorMessage) } });
  } catch {
    return serverError();
  }
};

/** POST /api/portal/realtor/messages — the realtor messages the office. */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requireUser(env, request);
  if (auth instanceof Response) return auth;
  if (auth.role !== 'realtor') return jsonError('Not a realtor account', 403);

  try {
    const { body, file } = await readMessageInput(request);
    if (!body && !file) return jsonError('Please type a message or attach a file.', 400);
    if (body.length > MAX_BODY) return jsonError('That message is too long.', 400);
    if (file && file.size > MAX_ATTACHMENT_BYTES) return jsonError('That file is too large (max 15 MB).', 413);

    let driveId: string | null = null;
    if (file) {
      const folderId = await ensureRealtorFolder(env, auth.id);
      if (!folderId) return jsonError('Could not create your folder.', 500);
      const uploaded = await uploadToDrive(env, folderId, file.name, file.type || 'application/octet-stream', file);
      driveId = uploaded.id;
    }

    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO realtor_messages (id, realtor_user_id, sender_role, sender_user_id, body, attachment_drive_id, attachment_name, attachment_type, read_by_realtor, read_by_office)
       VALUES (?, ?, 'realtor', ?, ?, ?, ?, ?, 1, 0)`
    ).bind(id, auth.id, auth.id, body, driveId, file?.name ?? null, file?.type ?? null).run();

    context.waitUntil(
      notifyOfficeOfRealtorMessage(env, auth.id, body || '(sent an attachment)').catch((e) => console.error('notifyOfficeOfRealtorMessage failed', e))
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
