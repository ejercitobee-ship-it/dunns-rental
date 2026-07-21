import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requireUser, jsonOk, jsonError, serverError } from '../../../lib/session';
import { handymanForUser } from '../../../lib/portal';
import { tradeMatches } from '../../../lib/maintenance';
import { serializeJob, JOB_COLUMNS, JOB_JOINS, type JobRow } from '../../../lib/handyman-jobs';

/**
 * GET /api/portal/handyman/jobs — the handyman's world in one call:
 *   available: unassigned, submitted requests matching their trades
 *   mine:      requests assigned to them that are not cancelled
 * Both are scoped server-side; nothing here trusts a client id.
 */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requireUser(env, request);
  if (auth instanceof Response) return auth;
  if (auth.role !== 'handyman') return jsonError('Not a handyman account', 403);

  try {
    const handyman = await handymanForUser(env, auth.id);
    if (!handyman) return jsonError('No active handyman record is linked to this login', 404);

    const availableRows = await env.DB.prepare(
      `SELECT ${JOB_COLUMNS} ${JOB_JOINS}
        WHERE m.assigned_handyman_id IS NULL AND m.status = 'submitted'
        ORDER BY m.created_at DESC`
    ).all<JobRow>();

    const mineRows = await env.DB.prepare(
      `SELECT ${JOB_COLUMNS} ${JOB_JOINS}
        WHERE m.assigned_handyman_id = ? AND m.status != 'cancelled'
        ORDER BY
          CASE m.status
            WHEN 'assigned' THEN 0 WHEN 'scheduled' THEN 1 WHEN 'in_progress' THEN 2
            WHEN 'completed' THEN 3 WHEN 'paid' THEN 4 ELSE 5 END,
          m.scheduled_for IS NULL, m.scheduled_for`
    )
      .bind(handyman.id)
      .all<JobRow>();

    // Only offer available jobs this handyman's trades match.
    const available = (availableRows.results || [])
      .filter((r) => tradeMatches(handyman.trades, (r.category as string) ?? null))
      .map((r) => serializeJob(r));
    const mine = (mineRows.results || []).map((r) => serializeJob(r));

    return jsonOk({ success: true, data: { available, mine } });
  } catch {
    return serverError();
  }
};
