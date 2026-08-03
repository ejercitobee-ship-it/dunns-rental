import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requireUser, jsonOk, jsonError, serverError } from '../../../../../lib/session';
import { handymanForUser } from '../../../../../lib/portal';
import { serializeJob, loadOwnedJob } from '../../../../../lib/handyman-jobs';
import { notifyTenant, notifyOffice } from '../../../../../lib/maintenance-notify';
import { sendPushToTenant } from '../../../../../lib/push';
import { generateAndSaveWorkReport } from '../../../../../lib/work-report';

// Which prior statuses each move is allowed from. Start work from an assigned or
// scheduled job; complete only from in progress. Anything else is a 409.
const ALLOWED_FROM: Record<string, string[]> = {
  in_progress: ['assigned', 'scheduled'],
  completed: ['in_progress'],
};

/**
 * POST /api/portal/handyman/jobs/:id/status — the handyman's Start and Complete
 * buttons. Transitions are guarded to a legal prior status. The tenant is
 * emailed on both, and the office is told when a job is done and ready to pay.
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
    const status = body.status;
    if (status !== 'in_progress' && status !== 'completed') {
      return jsonError('Unsupported status', 400);
    }

    const existing = await loadOwnedJob(env, jobId, handyman.id);
    if (!existing) return jsonError('Job not found', 404);
    if (!ALLOWED_FROM[status].includes(existing.status as string)) {
      return jsonError('This job cannot move to that status yet', 409);
    }

    // Stamp resolved_date when the work is finished, for the admin's records.
    const setResolved = status === 'completed' ? ", resolved_date = date('now', 'localtime')" : '';
    await env.DB.prepare(
      `UPDATE maintenance_requests SET status = ?${setResolved}, updated_at = unixepoch()
        WHERE id = ? AND assigned_handyman_id = ?`
    )
      .bind(status, jobId, handyman.id)
      .run();

    const row = await loadOwnedJob(env, jobId, handyman.id);
    if (!row) return serverError();
    const job = serializeJob(row);

    context.waitUntil(
      (async () => {
        const tenantId = row.tenant_id as string | null;
        if (status === 'in_progress') {
          await notifyTenant(env, row.tenant_email as string | null, 'Your maintenance is under way', [
            ['Issue', job.title],
            ['Status', 'The handyman has started the work.'],
          ]);
          await sendPushToTenant(env, tenantId, {
            title: 'Maintenance under way',
            body: `${job.title}: the handyman has started the work.`,
            url: '/portal/maintenance',
          });
        } else {
          const hName = await handymanName(env, handyman.id);
          await notifyTenant(env, row.tenant_email as string | null, 'Your maintenance is complete', [
            ['Issue', job.title],
            ['Status', 'The work is finished. Thank you.'],
          ]);
          await sendPushToTenant(env, tenantId, {
            title: 'Maintenance complete',
            body: `${job.title}: the work is finished.`,
            url: '/portal/maintenance',
          });
          await notifyOffice(env, `Job completed, ready to pay: ${job.title}`, [
            ['Handyman', hName],
            ['Location', job.locationLabel || 'Not set'],
          ]);
          await generateAndSaveWorkReport(env, row, hName).catch(e => console.error('work report failed', e));
        }
      })().catch((e) => console.error('status notify failed', e))
    );

    return jsonOk({ success: true, data: job });
  } catch {
    return serverError();
  }
};

async function handymanName(env: Env, id: string): Promise<string> {
  const r = await env.DB.prepare('SELECT name FROM handymen WHERE id = ?').bind(id).first<{ name: string }>();
  return r?.name || 'Unknown';
}
