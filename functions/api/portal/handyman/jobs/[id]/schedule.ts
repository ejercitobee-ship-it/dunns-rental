import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requireUser, jsonOk, jsonError, serverError } from '../../../../../lib/session';
import { handymanForUser } from '../../../../../lib/portal';
import { serializeJob, loadOwnedJob } from '../../../../../lib/handyman-jobs';
import { notifyTenant, prettyDay } from '../../../../../lib/maintenance-notify';
import { sendPushToTenant } from '../../../../../lib/push';

/** Accept 'YYYY-MM-DD' or 'YYYY-MM-DD HH:MM' (or with a T). Returns '' if bad. */
function normalizeSchedule(input: unknown): string {
  if (typeof input !== 'string') return '';
  const s = input.trim().replace('T', ' ');
  const m = s.match(/^(\d{4}-\d{2}-\d{2})(?:[ ](\d{2}:\d{2}))?$/);
  if (!m) return '';
  return m[2] ? `${m[1]} ${m[2]}` : m[1];
}

function scheduleLabel(s: string): string {
  const [day, time] = s.split(' ');
  return time ? `${prettyDay(day)} at ${time}` : prettyDay(day);
}

/**
 * POST /api/portal/handyman/jobs/:id/schedule — the handyman confirms the
 * appointment time (picked from the tenant's availability). Moves an assigned
 * or scheduled job to scheduled and emails the tenant the confirmed time.
 */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requireUser(env, request);
  if (auth instanceof Response) return auth;
  if (auth.role !== 'handyman') return jsonError('Not a handyman account', 403);

  try {
    const handyman = await handymanForUser(env, auth.id);
    if (!handyman) return jsonError('No active handyman record is linked to this login', 404);

    const jobId = params.id as string;
    const body = (await request.json()) as Record<string, unknown>;
    const scheduledFor = normalizeSchedule(body.scheduledFor);
    if (!scheduledFor) return jsonError('Pick a valid date and time', 400);

    const existing = await loadOwnedJob(env, jobId, handyman.id);
    if (!existing) return jsonError('Job not found', 404);
    if (!['assigned', 'scheduled'].includes(existing.status as string)) {
      return jsonError('This job cannot be scheduled from its current status', 409);
    }

    await env.DB.prepare(
      `UPDATE maintenance_requests SET scheduled_for = ?, status = 'scheduled', updated_at = unixepoch()
        WHERE id = ? AND assigned_handyman_id = ?`
    )
      .bind(scheduledFor, jobId, handyman.id)
      .run();

    const row = await loadOwnedJob(env, jobId, handyman.id);
    if (!row) return serverError();
    const job = serializeJob(row);

    context.waitUntil(
      Promise.all([
        notifyTenant(env, row.tenant_email as string | null, 'Your maintenance visit is scheduled', [
          ['Issue', job.title],
          ['When', scheduleLabel(scheduledFor)],
        ]),
        sendPushToTenant(env, row.tenant_id as string | null, {
          title: 'Maintenance visit scheduled',
          body: `${job.title}: ${scheduleLabel(scheduledFor)}`,
          url: '/portal/maintenance',
        }),
      ]).catch((e) => console.error('schedule notify failed', e))
    );

    return jsonOk({ success: true, data: job });
  } catch {
    return serverError();
  }
};
