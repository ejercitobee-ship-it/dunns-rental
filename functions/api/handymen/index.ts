import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../lib/session';
import { serializeHandyman } from '../../lib/serializers';
import { createPortalLogin, sendInviteLink } from '../../lib/invite';
import { MAINTENANCE_TRADES } from '../../lib/maintenance';

/** Keep only recognised trade slugs, so matching queries stay predictable. */
function cleanTrades(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const allowed = new Set<string>(MAINTENANCE_TRADES);
  return [...new Set(input.filter((t): t is string => typeof t === 'string' && allowed.has(t)))];
}

/** GET /api/handymen — the roster, for the admin page and the assign picker. */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requirePermission(env, request, 'properties_view');
  if (auth instanceof Response) return auth;

  try {
    const { results } = await env.DB.prepare(
      `SELECT h.*, u.image AS image
         FROM handymen h
         LEFT JOIN user u ON u.id = h.user_id
        ORDER BY h.is_active DESC, h.name`
    ).all();
    return jsonOk({ success: true, data: (results || []).map(serializeHandyman) });
  } catch {
    return serverError();
  }
};

/**
 * POST /api/handymen — add a handyman to the roster. When an email is given, a
 * portal login is created and a branded invite is emailed in the same step, so
 * a new handyman can sign in and start taking jobs without a second action.
 */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requirePermission(env, request, 'properties_edit');
  if (auth instanceof Response) return auth;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return jsonError('A name is required', 400);

    const email = typeof body.email === 'string' ? body.email.trim() : '';
    const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
    const trades = cleanTrades(body.trades);

    // Create the login first so a duplicate email fails before we write the
    // roster row, leaving nothing half-created.
    let userId: string | null = null;
    let emailSent = false;
    let inviteUrl: string | undefined;
    if (email) {
      try {
        userId = await createPortalLogin(env, { email, name, role: 'handyman' });
      } catch (e) {
        if ((e as Error).message === 'email-taken') {
          return jsonError('Someone already uses that email address', 400);
        }
        throw e;
      }
      const firstName = name.split(' ')[0] || name;
      const res = await sendInviteLink(env, request, userId, firstName, email, false);
      emailSent = res.sent;
      inviteUrl = res.sent ? undefined : res.inviteUrl;
    }

    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO handymen (id, user_id, name, phone, email, trades, is_active)
       VALUES (?, ?, ?, ?, ?, ?, 1)`
    )
      .bind(id, userId, name, phone || null, email || null, JSON.stringify(trades))
      .run();

    const row = await env.DB.prepare('SELECT * FROM handymen WHERE id = ?').bind(id).first();
    return jsonOk(
      { success: true, data: { handyman: serializeHandyman(row as Record<string, unknown>), emailSent, inviteUrl } },
      201
    );
  } catch {
    return serverError();
  }
};
