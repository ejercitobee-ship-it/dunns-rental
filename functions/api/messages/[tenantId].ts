import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../lib/session';
import { serializeMessage, notifyTenantOfReply, tenantContact } from '../../lib/messages';

const MAX_BODY = 4000;

/**
 * GET /api/messages/:tenantId — the full thread with one tenant. Opening it
 * marks that tenant's messages as read by the office.
 */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'tenants_view');
  if (auth instanceof Response) return auth;

  try {
    const tenantId = params.tenantId as string;
    const who = await tenantContact(env, tenantId);
    if (!who) return jsonError('Tenant not found', 404);

    // Where the tenant lives, for the conversation header.
    const place = await env.DB.prepare(
      `SELECT p.name AS propertyName, p.address AS propertyAddress, u.unit_number AS unitNumber
         FROM leases l
         JOIN lease_tenants lt ON lt.lease_id = l.id
         LEFT JOIN units u ON u.id = l.unit_id
         LEFT JOIN properties p ON p.id = l.property_id
        WHERE lt.tenant_id = ? AND l.status != 'ended'
        ORDER BY l.start_date DESC LIMIT 1`
    ).bind(tenantId).first<{ propertyName: string | null; propertyAddress: string | null; unitNumber: string | null }>();

    const { results } = await env.DB.prepare(
      'SELECT * FROM messages WHERE tenant_id = ? ORDER BY created_at ASC'
    ).bind(tenantId).all();

    await env.DB.prepare(
      `UPDATE messages SET read_by_office = 1
        WHERE tenant_id = ? AND sender_role = 'tenant' AND read_by_office = 0`
    ).bind(tenantId).run();

    return jsonOk({
      success: true,
      data: {
        tenantId,
        tenantName: who.name,
        propertyName: place?.propertyName ?? null,
        propertyAddress: place?.propertyAddress ?? null,
        unitNumber: place?.unitNumber ?? null,
        messages: (results || []).map(serializeMessage),
      },
    });
  } catch {
    return serverError();
  }
};

/** POST /api/messages/:tenantId — the office replies to a tenant. */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'tenants_edit');
  if (auth instanceof Response) return auth;

  try {
    const tenantId = params.tenantId as string;
    const who = await tenantContact(env, tenantId);
    if (!who) return jsonError('Tenant not found', 404);

    const raw = (await request.json()) as { body?: string };
    const body = (raw.body || '').trim();
    if (!body) return jsonError('Please type a message.', 400);
    if (body.length > MAX_BODY) return jsonError('That message is too long.', 400);

    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO messages (id, tenant_id, sender_role, sender_user_id, body, read_by_office, read_by_tenant)
       VALUES (?, ?, 'office', ?, ?, 1, 0)`
    ).bind(id, tenantId, auth.id, body).run();

    context.waitUntil(
      notifyTenantOfReply(env, tenantId, body).catch((e) => console.error('notifyTenantOfReply failed', e))
    );

    const row = await env.DB.prepare('SELECT * FROM messages WHERE id = ?').bind(id).first();
    return jsonOk({ success: true, data: serializeMessage(row as Record<string, unknown>) }, 201);
  } catch {
    return serverError();
  }
};
