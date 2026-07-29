import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requireUser, jsonOk, jsonError, serverError } from '../../../lib/session';
import { handymanForUser } from '../../../lib/portal';
import { serializeHandymanMessage, notifyOfficeOfVendorMessage } from '../../../lib/handyman-messages';
import { readMessageInput, MAX_ATTACHMENT_BYTES } from '../../../lib/messages';
import { ensureVendorFolder, uploadToDrive, DriveNotConnected } from '../../../lib/google';

const MAX_BODY = 4000;

/**
 * GET /api/portal/handyman/messages — the handyman's own thread with the office.
 * `?count=1` returns just the unread-from-office count (nav badge) and marks
 * nothing read; the full fetch marks office messages read.
 */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requireUser(env, request);
  if (auth instanceof Response) return auth;
  if (auth.role !== 'handyman') return jsonError('Not a handyman account', 403);

  try {
    const handyman = await handymanForUser(env, auth.id);
    if (!handyman) return jsonError('No active handyman record is linked to this login', 404);

    const url = new URL(request.url);
    if (url.searchParams.get('count') === '1') {
      const row = await env.DB.prepare(
        `SELECT COUNT(*) AS n FROM handyman_messages
          WHERE handyman_id = ? AND sender_role = 'office' AND read_by_handyman = 0`
      ).bind(handyman.id).first<{ n: number }>();
      return jsonOk({ success: true, data: { count: row?.n ?? 0 } });
    }

    const { results } = await env.DB.prepare(
      'SELECT * FROM handyman_messages WHERE handyman_id = ? ORDER BY created_at ASC'
    ).bind(handyman.id).all();

    await env.DB.prepare(
      `UPDATE handyman_messages SET read_by_handyman = 1
        WHERE handyman_id = ? AND sender_role = 'office' AND read_by_handyman = 0`
    ).bind(handyman.id).run();

    return jsonOk({ success: true, data: { messages: (results || []).map(serializeHandymanMessage) } });
  } catch {
    return serverError();
  }
};

/** POST /api/portal/handyman/messages — the handyman messages the office. */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requireUser(env, request);
  if (auth instanceof Response) return auth;
  if (auth.role !== 'handyman') return jsonError('Not a handyman account', 403);

  try {
    const handyman = await handymanForUser(env, auth.id);
    if (!handyman) return jsonError('No active handyman record is linked to this login', 404);

    const { body, file } = await readMessageInput(request);
    if (!body && !file) return jsonError('Please type a message or attach a file.', 400);
    if (body.length > MAX_BODY) return jsonError('That message is too long.', 400);
    if (file && file.size > MAX_ATTACHMENT_BYTES) return jsonError('That file is too large (max 15 MB).', 413);

    let driveId: string | null = null;
    if (file) {
      const folderId = await ensureVendorFolder(env, handyman.id);
      if (!folderId) return jsonError('Could not find your vendor folder.', 404);
      const uploaded = await uploadToDrive(env, folderId, file.name, file.type || 'application/octet-stream', file);
      driveId = uploaded.id;
    }

    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO handyman_messages (id, handyman_id, sender_role, sender_user_id, body, attachment_drive_id, attachment_name, attachment_type, read_by_handyman, read_by_office)
       VALUES (?, ?, 'handyman', ?, ?, ?, ?, ?, 1, 0)`
    ).bind(id, handyman.id, auth.id, body, driveId, file?.name ?? null, file?.type ?? null).run();

    context.waitUntil(
      notifyOfficeOfVendorMessage(env, handyman.id, body || '(sent an attachment)').catch((e) => console.error('notifyOfficeOfVendorMessage failed', e))
    );

    const row = await env.DB.prepare('SELECT * FROM handyman_messages WHERE id = ?').bind(id).first();
    return jsonOk({ success: true, data: serializeHandymanMessage(row as Record<string, unknown>) }, 201);
  } catch (err) {
    if (err instanceof DriveNotConnected) return jsonError('Attachments are unavailable right now. Please try again without the file.', 503);
    return serverError();
  }
};
