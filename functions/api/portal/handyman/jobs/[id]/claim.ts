import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requireUser, jsonOk, jsonError, serverError } from '../../../../../lib/session';
import { handymanForUser } from '../../../../../lib/portal';
import { tradeMatches, logStatusChange } from '../../../../../lib/maintenance';
import { serializeJob, loadOwnedJob } from '../../../../../lib/handyman-jobs';
import { notifyTenant, notifyOffice } from '../../../../../lib/maintenance-notify';
import { sendPushToTenant } from '../../../../../lib/push';

/**
 * POST /api/portal/handyman/jobs/:id/claim — the handyman takes an open job.
 * Only an unassigned, submitted request their trade matches can be claimed, in
 * one guarded UPDATE so two handymen cannot both win the same job. The tenant
 * and office are emailed best-effort.
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
    const job = await env.DB.prepare(
      'SELECT category, status, assigned_handyman_id FROM maintenance_requests WHERE id = ?'
    )
      .bind(jobId)
      .first<{ category: string | null; status: string; assigned_handyman_id: string | null }>();
    if (!job) return jsonError('Job not found', 404);
    if (!tradeMatches(handyman.trades, job.category)) {
      return jsonError('This job is not in your trades', 403);
    }

    // Guarded so the claim only lands while the job is still open and unclaimed.
    const res = await env.DB.prepare(
      `UPDATE maintenance_requests
          SET assigned_handyman_id = ?, status = 'assigned', updated_at = unixepoch()
        WHERE id = ? AND assigned_handyman_id IS NULL AND status = 'submitted'`
    )
      .bind(handyman.id, jobId)
      .run();
    if (!res.meta.changes) return jsonError('This job was already taken', 409);

    // Log after the guarded update so only successful claims are recorded.
    await logStatusChange(env.DB, jobId, 'submitted', 'assigned', auth.id, auth.name, 'Claimed job').run();

    const row = await loadOwnedJob(env, jobId, handyman.id);
    if (!row) return serverError();

    const hName = await env.DB.prepare('SELECT name, phone FROM handymen WHERE id = ?')
      .bind(handyman.id)
      .first<{ name: string; phone: string | null }>();
    const job2 = serializeJob(row);
    context.waitUntil(
      Promise.all([
        notifyTenant(env, row.tenant_email as string | null, `Your maintenance request is being handled`, [
          ['Issue', job2.title],
          ['Handyman', hName?.name || 'Assigned'],
          ...(hName?.phone ? [['Contact', hName.phone] as [string, string]] : []),
          ['Next', 'They will confirm a time from your availability.'],
        ]),
        notifyOffice(env, `Job claimed: ${job2.title}`, [
          ['Handyman', hName?.name || 'Unknown'],
          ['Location', job2.locationLabel || 'Not set'],
        ]),
        sendPushToTenant(env, row.tenant_id as string | null, {
          title: 'Your maintenance request is being handled',
          body: `${job2.title}: ${hName?.name || 'a handyman'} will confirm a time.`,
          url: '/portal/maintenance',
        }),
      ]).catch((e) => console.error('claim notify failed', e))
    );

    return jsonOk({ success: true, data: job2 });
  } catch {
    return serverError();
  }
};
