import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../lib/session';
import { sendEmail, portalWelcomeEmail } from '../../lib/email';
import { companySettings } from '../../lib/receipts';
import { SITE_URL } from '../../lib/site';

/**
 * POST /api/tenants/welcome-emails — send a portal welcome email to tenants.
 *
 * Body: { tenantIds: string[] }
 *
 * Sends a branded welcome email to each tenant that has an email address,
 * describing what the portal offers. This is separate from the invite
 * (set-password) email: it is for tenants who already have a login or who
 * you simply want to inform about the portal's benefits.
 */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requirePermission(env, request, 'tenants_edit');
  if (auth instanceof Response) return auth;

  try {
    const body = await request.json<{ tenantIds?: string[] }>();
    const tenantIds = body.tenantIds;
    if (!tenantIds || !Array.isArray(tenantIds) || tenantIds.length === 0) {
      return jsonError('tenantIds is required', 400);
    }
    if (tenantIds.length > 200) {
      return jsonError('Cannot send more than 200 emails at once', 400);
    }

    const placeholders = tenantIds.map(() => '?').join(',');
    const rows = await env.DB.prepare(
      `SELECT id, first_name, last_name, email FROM tenants WHERE id IN (${placeholders})`
    ).bind(...tenantIds).all<{ id: string; first_name: string; last_name: string; email: string | null }>();

    const c = await companySettings(env);
    const cityStateZip = [[c.city, c.state].filter(Boolean).join(', '), c.zipCode].filter(Boolean).join(' ');
    const contact = [c.address, cityStateZip, [c.phone, c.email].filter(Boolean).join(' · ')]
      .filter(s => s && s.trim()).join(' · ');
    const portalUrl = `${SITE_URL}/portal`;

    let sent = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const tenant of rows.results) {
      if (!tenant.email) {
        skipped += 1;
        continue;
      }
      const mail = portalWelcomeEmail({
        name: tenant.first_name,
        portalUrl,
        companyName: c.companyName,
        contact,
      });
      const ok = await sendEmail(env, { to: tenant.email, ...mail });
      if (ok) {
        sent += 1;
      } else {
        errors.push(`${tenant.first_name} ${tenant.last_name}`);
      }
    }

    return jsonOk({ sent, skipped, failed: errors.length, errors });
  } catch {
    return serverError();
  }
};
