import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../../lib/session';
import { serializeMaintenance } from '../../../lib/serializers';
import { logStatusChange } from '../../../lib/maintenance';
import { JOB_COLUMNS, JOB_JOINS, type JobRow } from '../../../lib/handyman-jobs';
import { getManagementUserIds, notifyMultiple } from '../../../lib/notify';

/**
 * POST /api/maintenance/:id/release — the office marks a submitted request as
 * "available" so any trade-matched handyman can see and claim it from their
 * portal. Only submitted (office-review) jobs can be released.
 */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'properties_edit');
  if (auth instanceof Response) return auth;

  try {
    const id = params.id as string;
    const existing = await env.DB.prepare('SELECT status, title FROM maintenance_requests WHERE id = ?')
      .bind(id)
      .first<{ status: string; title: string }>();
    if (!existing) return jsonError('Request not found', 404);
    if (existing.status !== 'submitted') {
      return jsonError('Only submitted requests can be released to handymen', 400);
    }

    const stmts = [
      env.DB.prepare(
        `UPDATE maintenance_requests SET status = 'available', updated_at = unixepoch() WHERE id = ?`
      ).bind(id),
      logStatusChange(env.DB, id, 'submitted', 'available', auth.id, auth.name, 'Released to handymen'),
    ];
    await env.DB.batch(stmts);

    const row = await env.DB.prepare(`SELECT ${JOB_COLUMNS} ${JOB_JOINS} WHERE m.id = ?`).bind(id).first<JobRow>();
    if (!row) return serverError();

    context.waitUntil(
      getManagementUserIds(env, auth.id).then(userIds =>
        notifyMultiple(env, userIds.map(uid => ({
          userId: uid,
          type: 'maintenance',
          category: 'job_released',
          title: `Job released to handymen`,
          message: existing.title,
          entityType: 'maintenance_requests',
          entityId: id,
          route: '/maintenance',
        })))
      ).catch(() => {})
    );

    return jsonOk({ success: true, data: serializeMaintenance(row) });
  } catch {
    return serverError();
  }
};
