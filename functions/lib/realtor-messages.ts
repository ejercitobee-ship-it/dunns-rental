import { type Env } from './session';
import { sendPushToUser } from './push';
import { notifyOffice, notifyTenant } from './maintenance-notify';
import { officeUserIds } from './messages';
import { SITE_URL } from './site';

type Row = Record<string, unknown>;

export function serializeRealtorMessage(r: Row) {
  return {
    id: r.id,
    realtorUserId: r.realtor_user_id,
    senderRole: r.sender_role,
    senderName: r.sender_name ?? undefined,
    body: r.body,
    createdAt: r.created_at,
    attachmentUrl: r.attachment_drive_id ? `/api/photo/${r.attachment_drive_id}` : undefined,
    attachmentName: r.attachment_name ?? undefined,
    attachmentType: r.attachment_type ?? undefined,
  };
}

export async function realtorContact(
  env: Env,
  realtorUserId: string,
): Promise<{ name: string; email: string | null; userId: string } | null> {
  const u = await env.DB.prepare(
    `SELECT u.id, u.name, u.email FROM user u
       JOIN user_roles ur ON ur.user_id = u.id
      WHERE u.id = ? AND ur.role = 'realtor'`
  ).bind(realtorUserId).first<{ id: string; name: string | null; email: string | null }>();
  if (!u) return null;
  return { name: (u.name || 'Realtor').trim(), email: u.email, userId: u.id };
}

export async function notifyOfficeOfRealtorMessage(env: Env, realtorUserId: string, body: string): Promise<void> {
  const who = await realtorContact(env, realtorUserId);
  const name = who?.name || 'A realtor';
  const heading = `New message from ${name}`;
  const url = `${SITE_URL}/messages`;
  await notifyOffice(env, heading, [['From', name], ['Message', body || '(attachment)']]);
  for (const uid of await officeUserIds(env)) {
    await sendPushToUser(env, uid, { title: heading, body: body || 'Sent an attachment', url });
  }
}

export async function notifyRealtorOfReply(env: Env, realtorUserId: string, body: string): Promise<void> {
  const who = await realtorContact(env, realtorUserId);
  const heading = 'New message from MH Dunn Property';
  await notifyTenant(env, who?.email, heading, [['Message', body || '(attachment)']]);
  await sendPushToUser(env, realtorUserId, { title: heading, body: body || 'Sent an attachment', url: `${SITE_URL}/portal/messages` });
}
