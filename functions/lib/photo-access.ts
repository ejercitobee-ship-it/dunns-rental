import type { Env, SessionUser } from './session';
import {
  tenantIdForUser,
  handymanForUser,
  realtorTenantIds,
  serverToday,
} from './portal';

const PORTAL_ROLES = new Set(['tenant', 'realtor', 'handyman']);

/**
 * May this caller stream the Drive file behind `/api/photo/:id`?
 *
 * The id is a raw Google Drive id, so the route cannot rely on the id being
 * secret. Management (non-portal) users are the trusted operators who view
 * staff, tenant, realtor, and handyman photos and message attachments across
 * the whole app, so they pass. Portal users (tenant / realtor / handyman) are
 * restricted to Drive ids that live inside their own reachable scope: their own
 * profile photo, their own tenant photo, attachments in their own message
 * thread, and (for realtors) the photos of tenants they currently reach.
 *
 * Anything else is a miss, which the endpoint turns into a 404.
 */
export async function canAccessPhotoId(
  env: Env,
  auth: SessionUser,
  driveId: string
): Promise<boolean> {
  if (!driveId) return false;

  // Trusted operators: management roles see photos app-wide.
  if (!PORTAL_ROLES.has(auth.role)) return true;

  // Everyone may fetch their own profile photo (user.image).
  if (auth.image && auth.image === driveId) return true;

  if (auth.role === 'tenant') {
    const tenantId = await tenantIdForUser(env, auth.id);
    if (!tenantId) return false;
    const ownPhoto = await env.DB.prepare(
      'SELECT 1 FROM tenants WHERE id = ? AND photo_drive_id = ?'
    ).bind(tenantId, driveId).first();
    if (ownPhoto) return true;
    const ownThreadAttachment = await env.DB.prepare(
      'SELECT 1 FROM messages WHERE tenant_id = ? AND attachment_drive_id = ?'
    ).bind(tenantId, driveId).first();
    return !!ownThreadAttachment;
  }

  if (auth.role === 'realtor') {
    const ownThreadAttachment = await env.DB.prepare(
      'SELECT 1 FROM realtor_messages WHERE realtor_user_id = ? AND attachment_drive_id = ?'
    ).bind(auth.id, driveId).first();
    if (ownThreadAttachment) return true;
    const reachable = await realtorTenantIds(env, auth.id, serverToday());
    if (reachable.length > 0) {
      const placeholders = reachable.map(() => '?').join(',');
      const tenantPhoto = await env.DB.prepare(
        `SELECT 1 FROM tenants WHERE id IN (${placeholders}) AND photo_drive_id = ?`
      ).bind(...reachable, driveId).first();
      if (tenantPhoto) return true;
    }
    return false;
  }

  if (auth.role === 'handyman') {
    const handyman = await handymanForUser(env, auth.id);
    if (!handyman) return false;
    const ownThreadAttachment = await env.DB.prepare(
      'SELECT 1 FROM handyman_messages WHERE handyman_id = ? AND attachment_drive_id = ?'
    ).bind(handyman.id, driveId).first();
    return !!ownThreadAttachment;
  }

  return false;
}
