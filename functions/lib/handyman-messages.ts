import { type Env } from './session';
import { sendPushToUser } from './push';
import { notifyOffice, notifyTenant } from './maintenance-notify';
import { officeUserIds } from './messages';
import { SITE_URL } from './site';

type Row = Record<string, unknown>;

/** One message in an office<->handyman (vendor) thread, camelCased for the app. */
export function serializeHandymanMessage(r: Row) {
  return {
    id: r.id,
    handymanId: r.handyman_id,
    senderRole: r.sender_role,
    body: r.body,
    createdAt: r.created_at,
    attachmentUrl: r.attachment_drive_id ? `/api/photo/${r.attachment_drive_id}` : undefined,
    attachmentName: r.attachment_name ?? undefined,
    attachmentType: r.attachment_type ?? undefined,
  };
}

/** A handyman's name, email, and login id, for notifications. */
export async function handymanContact(
  env: Env,
  handymanId: string
): Promise<{ name: string; email: string | null; userId: string | null } | null> {
  const h = await env.DB.prepare('SELECT name, email, user_id FROM handymen WHERE id = ?')
    .bind(handymanId)
    .first<{ name: string | null; email: string | null; user_id: string | null }>();
  if (!h) return null;
  return { name: (h.name || 'Handyman').trim(), email: h.email, userId: h.user_id };
}

/** A handyman messaged the office: email + push every office login. Best-effort. */
export async function notifyOfficeOfVendorMessage(env: Env, handymanId: string, body: string): Promise<void> {
  const who = await handymanContact(env, handymanId);
  const name = who?.name || 'A handyman';
  const heading = `New message from ${name}`;
  const url = `${SITE_URL}/messages`;
  await notifyOffice(env, heading, [['From', name], ['Message', body || '(attachment)']]);
  for (const uid of await officeUserIds(env)) {
    await sendPushToUser(env, uid, { title: heading, body: body || 'Sent an attachment', url });
  }
}

/** The office messaged a handyman: email + push them. Best-effort. */
export async function notifyHandymanOfReply(env: Env, handymanId: string, body: string): Promise<void> {
  const who = await handymanContact(env, handymanId);
  const heading = 'New message from MH Dunn Property';
  await notifyTenant(env, who?.email, heading, [['Message', body || '(attachment)']]);
  if (who?.userId) {
    await sendPushToUser(env, who.userId, { title: heading, body: body || 'Sent an attachment', url: `${SITE_URL}/portal/messages` });
  }
}
