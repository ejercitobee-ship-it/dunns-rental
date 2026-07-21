import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../../lib/session';
import { serializeMaintenance } from '../../../lib/serializers';
import { JOB_COLUMNS, JOB_JOINS, buildNotice, tenantEmail, type JobRow } from '../../../lib/handyman-jobs';
import { availabilityText, notifyTenant } from '../../../lib/maintenance-notify';
import { sendEmail } from '../../../lib/email';
import { companySettings } from '../../../lib/receipts';

/**
 * POST /api/maintenance/:id/assign — the admin assigns a job to a handyman (or
 * clears the assignment with handymanId: null). Assigning moves a submitted job
 * to assigned, emails the handyman the job, and tells the tenant who is coming.
 */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'properties_edit');
  if (auth instanceof Response) return auth;

  try {
    const id = params.id as string;
    const body = (await request.json()) as Record<string, unknown>;
    const handymanId = typeof body.handymanId === 'string' && body.handymanId ? body.handymanId : null;

    const existing = await env.DB.prepare('SELECT status FROM maintenance_requests WHERE id = ?')
      .bind(id)
      .first<{ status: string }>();
    if (!existing) return jsonError('Request not found', 404);

    let handyman: { id: string; name: string; email: string | null; is_active: number } | null = null;
    if (handymanId) {
      handyman = await env.DB.prepare('SELECT id, name, email, is_active FROM handymen WHERE id = ?')
        .bind(handymanId)
        .first();
      if (!handyman) return jsonError('Handyman not found', 404);
      if (!handyman.is_active) return jsonError('That handyman is inactive', 400);
    }

    // Clearing the assignment sends the job back to the open pool; assigning a
    // submitted job advances it to assigned. A job already in progress keeps its
    // status so a reassignment does not rewind real work.
    let newStatus = existing.status;
    if (!handymanId) newStatus = 'submitted';
    else if (existing.status === 'submitted') newStatus = 'assigned';

    await env.DB.prepare(
      `UPDATE maintenance_requests SET assigned_handyman_id = ?, status = ?, updated_at = unixepoch() WHERE id = ?`
    )
      .bind(handymanId, newStatus, id)
      .run();

    const row = await env.DB.prepare(`SELECT ${JOB_COLUMNS} ${JOB_JOINS} WHERE m.id = ?`).bind(id).first<JobRow>();
    if (!row) return serverError();

    if (handyman) {
      const notice = buildNotice(row);
      const c = await companySettings(env);
      const handymanEmail = handyman.email;
      const hName = handyman.name;
      context.waitUntil(
        (async () => {
          if (handymanEmail) {
            const rows: [string, string][] = [
              ['Issue', notice.title],
              ['Category', notice.category || 'General'],
              ['Location', notice.locationLabel || 'Not set'],
              ['Availability', availabilityText(notice.availability)],
            ];
            await sendEmail(env, {
              to: handymanEmail,
              subject: `You have been assigned a job: ${notice.title}`,
              html: `<div style="font-family:sans-serif"><b>${c.companyName}</b><p>You have been assigned a maintenance job. Open your portal to confirm a time.</p></div>`,
              text: `${c.companyName}\nYou have been assigned: ${notice.title}\n${rows.map(([k, v]) => `${k}: ${v}`).join('\n')}`,
            });
          }
          await notifyTenant(env, tenantEmail(row), 'Your maintenance request is being handled', [
            ['Issue', notice.title],
            ['Handyman', hName],
            ['Next', 'They will confirm a time from your availability.'],
          ]);
        })().catch((e) => console.error('assign notify failed', e))
      );
    }

    return jsonOk({ success: true, data: serializeMaintenance(row) });
  } catch {
    return serverError();
  }
};
