import { type Env } from './session';
import { sendPushToUser, sendPushToTenant } from './push';
import { notifyOffice, notifyTenant } from './maintenance-notify';
import { SITE_URL } from './site';

type Row = Record<string, unknown>;

export const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024; // 15 MB

/**
 * Read a message-send request, which may be JSON (body only) or multipart
 * (body + an optional file). Kept in one place so the tenant, office, and
 * handyman send endpoints agree on how they parse input.
 */
export async function readMessageInput(request: Request): Promise<{ body: string; file: File | null }> {
  const ct = request.headers.get('content-type') || '';
  if (ct.includes('multipart/form-data')) {
    const form = await request.formData();
    const body = String(form.get('body') || '').trim();
    const f = form.get('file') as unknown as File | null;
    const file = f && typeof f.arrayBuffer === 'function' ? f : null;
    return { body, file };
  }
  const raw = (await request.json().catch(() => ({}))) as { body?: string };
  return { body: (raw.body || '').trim(), file: null };
}

/** One message in a tenant/office thread, camelCased for the app. */
export function serializeMessage(r: Row) {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    senderRole: r.sender_role,
    senderName: r.sender_name ?? undefined,
    body: r.body,
    createdAt: r.created_at,
    // An attachment is served through the generic /api/photo route (any Drive
    // file, images inline). The drive id only ever reaches thread participants.
    attachmentUrl: r.attachment_drive_id ? `/api/photo/${r.attachment_drive_id}` : undefined,
    attachmentName: r.attachment_name ?? undefined,
    attachmentType: r.attachment_type ?? undefined,
  };
}

/**
 * Every internal staff login that should hear about a new tenant message.
 * The office is whoever holds an owner/admin role; portal roles (tenant,
 * realtor, handyman) are never notified as "the office".
 */
export async function officeUserIds(env: Env): Promise<string[]> {
  const { results } = await env.DB.prepare(
    `SELECT DISTINCT user_id FROM user_roles WHERE role IN ('super_admin', 'admin')`
  ).all<{ user_id: string }>();
  return (results || []).map((r) => r.user_id).filter(Boolean);
}

/** A tenant's display name and email, for notifications. */
export async function tenantContact(
  env: Env,
  tenantId: string
): Promise<{ name: string; email: string | null } | null> {
  const t = await env.DB.prepare(
    'SELECT first_name, last_name, email FROM tenants WHERE id = ?'
  )
    .bind(tenantId)
    .first<{ first_name: string; last_name: string; email: string | null }>();
  if (!t) return null;
  return { name: `${t.first_name} ${t.last_name}`.trim(), email: t.email };
}

/**
 * A tenant sent a message: email the office and push to every office login.
 * Best-effort, run inside waitUntil by the caller.
 */
export async function notifyOfficeOfMessage(env: Env, tenantId: string, body: string): Promise<void> {
  const who = await tenantContact(env, tenantId);
  const name = who?.name || 'A tenant';
  const heading = `New message from ${name}`;
  const url = `${SITE_URL}/messages`;

  await notifyOffice(env, heading, [
    ['From', name],
    ['Message', body],
  ]);

  for (const uid of await officeUserIds(env)) {
    await sendPushToUser(env, uid, { title: heading, body, url });
  }
}

/**
 * The office replied: email and push the tenant. Best-effort.
 */
export async function notifyTenantOfReply(env: Env, tenantId: string, body: string): Promise<void> {
  const who = await tenantContact(env, tenantId);
  const heading = 'New message from MH Dunn Property';
  await notifyTenant(env, who?.email, heading, [['Message', body]]);
  await sendPushToTenant(env, tenantId, {
    title: heading,
    body,
    url: `${SITE_URL}/portal/messages`,
  });
}
