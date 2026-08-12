import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requireUser, jsonOk, jsonError, serverError } from '../../lib/session';
import { tenantIdForUser } from '../../lib/portal';
import { serializeMessage, notifyOfficeOfMessage, readMessageInput, MAX_ATTACHMENT_BYTES } from '../../lib/messages';
import { ensureTenantFolder, uploadToDrive, DriveNotConnected } from '../../lib/google';

const MAX_BODY = 4000;

/**
 * GET /api/portal/messages — the tenant's own thread with the office.
 * `?count=1` returns only the number of office messages the tenant has not
 * read yet (cheap, for the nav badge) and does NOT mark anything read.
 * The full fetch marks every office message as read.
 */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requireUser(env, request);
  if (auth instanceof Response) return auth;
  if (auth.role !== 'tenant') return jsonError('Not a tenant account', 403);

  try {
    const tenantId = await tenantIdForUser(env, auth.id);
    if (!tenantId) return jsonError('No tenant record is linked to this login', 404);

    const url = new URL(request.url);
    if (url.searchParams.get('count') === '1') {
      const row = await env.DB.prepare(
        `SELECT COUNT(*) AS n FROM messages
          WHERE tenant_id = ? AND sender_role = 'office' AND read_by_tenant = 0`
      ).bind(tenantId).first<{ n: number }>();
      return jsonOk({ success: true, data: { count: row?.n ?? 0 } });
    }

    const { results } = await env.DB.prepare(
      `SELECT m.*, u.name AS sender_name
         FROM messages m
         LEFT JOIN user u ON u.id = m.sender_user_id
        WHERE m.tenant_id = ?
        ORDER BY m.created_at ASC`
    ).bind(tenantId).all();

    // Opening the thread clears the tenant's unread office messages.
    await env.DB.prepare(
      `UPDATE messages SET read_by_tenant = 1
        WHERE tenant_id = ? AND sender_role = 'office' AND read_by_tenant = 0`
    ).bind(tenantId).run();

    return jsonOk({ success: true, data: { messages: (results || []).map(serializeMessage) } });
  } catch {
    return serverError();
  }
};

/** POST /api/portal/messages — the tenant sends a message to the office. */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requireUser(env, request);
  if (auth instanceof Response) return auth;
  if (auth.role !== 'tenant') return jsonError('Not a tenant account', 403);

  try {
    const tenantId = await tenantIdForUser(env, auth.id);
    if (!tenantId) return jsonError('No tenant record is linked to this login', 404);

    const { body, file } = await readMessageInput(request);
    if (!body && !file) return jsonError('Please type a message or attach a file.', 400);
    if (body.length > MAX_BODY) return jsonError('That message is too long.', 400);
    if (file && file.size > MAX_ATTACHMENT_BYTES) return jsonError('That file is too large (max 15 MB).', 413);

    // The attachment goes into the tenant's own Drive folder.
    let driveId: string | null = null;
    if (file) {
      const folderId = await ensureTenantFolder(env, tenantId);
      const uploaded = await uploadToDrive(env, folderId, file.name, file.type || 'application/octet-stream', file);
      driveId = uploaded.id;
    }

    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO messages (id, tenant_id, sender_role, sender_user_id, body, attachment_drive_id, attachment_name, attachment_type, read_by_tenant, read_by_office)
       VALUES (?, ?, 'tenant', ?, ?, ?, ?, ?, 1, 0)`
    ).bind(id, tenantId, auth.id, body, driveId, file?.name ?? null, file?.type ?? null).run();

    context.waitUntil(
      notifyOfficeOfMessage(env, tenantId, body || '(sent an attachment)').catch((e) => console.error('notifyOfficeOfMessage failed', e))
    );

    const row = await env.DB.prepare(
      `SELECT m.*, u.name AS sender_name FROM messages m LEFT JOIN user u ON u.id = m.sender_user_id WHERE m.id = ?`
    ).bind(id).first();
    return jsonOk({ success: true, data: serializeMessage(row as Record<string, unknown>) }, 201);
  } catch (err) {
    if (err instanceof DriveNotConnected) return jsonError('Attachments are unavailable right now. Please try again without the file.', 503);
    return serverError();
  }
};
