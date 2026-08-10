import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, getSessionUser, jsonOk, jsonError, serverError } from '../../lib/session';

/**
 * POST /api/cron/lease-expirations — flip scheduled terminations to 'ended'.
 *
 * When a user terminates a tenancy with a FUTURE date the lease stays active
 * until that date (the tenant keeps showing on the Active list and rent keeps
 * billing). This endpoint, called daily by the scheduled worker, finds every
 * active lease whose end_date + end_reason are set and whose end_date has
 * passed, then flips its status to 'ended'.
 *
 * Authorized via CRON_SECRET (bearer token) or a signed-in super_admin /
 * settings_edit user so it can also be triggered by hand.
 */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;

  const auth = request.headers.get('Authorization') || '';
  const presented = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  const cronOk = !!env.CRON_SECRET && presented === env.CRON_SECRET;
  if (!cronOk) {
    const user = await getSessionUser(env, request);
    if (!user) return jsonError('Not authorized', 401);
    const canTrigger = user.role === 'super_admin' ||
      (user.permissions ? user.permissions.includes('settings_edit') : false);
    if (!canTrigger) return jsonError('Not authorized', 401);
  }

  try {
    // Use the server's current UTC date. The app stores dates as local
    // calendar days (America/Chicago) but one day of drift is acceptable for
    // a daily cron; worst case a lease flips on the day after the end date
    // rather than exactly on it.
    const today = new Date().toISOString().slice(0, 10);

    // Find active leases that were scheduled for termination (end_reason is
    // only set when the user explicitly terminates; a normal end_date alone
    // without end_reason is not a termination).
    const { results } = await env.DB.prepare(
      `SELECT id, end_date, end_reason, property_id, unit_id
         FROM leases
        WHERE status = 'active'
          AND end_date IS NOT NULL
          AND end_reason IS NOT NULL
          AND end_date <= ?`
    ).bind(today).all<{
      id: string; end_date: string; end_reason: string;
      property_id: string | null; unit_id: string | null;
    }>();

    if (!results || results.length === 0) {
      return jsonOk({ success: true, message: 'No leases to expire', count: 0 });
    }

    // Flip each lease to 'ended' in a single batch.
    const statements = results.map(lease =>
      env.DB.prepare(
        `UPDATE leases
            SET status = 'ended', updated_at = unixepoch()
          WHERE id = ? AND status = 'active'`
      ).bind(lease.id)
    );

    await env.DB.batch(statements);

    const ids = results.map(l => l.id);
    console.log(`lease-expirations: flipped ${ids.length} lease(s) to ended: ${ids.join(', ')}`);

    return jsonOk({
      success: true,
      message: `Expired ${results.length} lease(s)`,
      count: results.length,
      leaseIds: ids,
    });
  } catch (err) {
    console.error('lease-expirations error:', err);
    return serverError();
  }
};
