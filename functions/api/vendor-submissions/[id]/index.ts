import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../../lib/session';
import { logActivityStmt } from '../../../lib/activity';

/** DELETE /api/vendor-submissions/:id — super-admin deletes a vendor submission. */
export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'maintenance_approve');
  if (auth instanceof Response) return auth;

  try {
    const id = params.id as string;
    const sub = await env.DB.prepare(
      `SELECT vs.vendor_name, vs.company_name, vs.expense_id,
              m.title AS job_title
         FROM vendor_submissions vs
         LEFT JOIN maintenance_requests m ON m.id = vs.maintenance_request_id
        WHERE vs.id = ?`
    ).bind(id).first<{
      vendor_name: string | null;
      company_name: string | null;
      expense_id: string | null;
      job_title: string | null;
    }>();
    if (!sub) return jsonError('Submission not found', 404);

    const stmts = [
      env.DB.prepare('DELETE FROM vendor_submissions WHERE id = ?').bind(id),
      logActivityStmt(env.DB, auth, {
        module: 'maintenance',
        action: 'Deleted vendor submission',
        description: `${sub.company_name || sub.vendor_name || 'Vendor'} for "${sub.job_title || 'Maintenance'}"`,
      }),
    ];
    // Also remove the auto-created expense if one exists.
    if (sub.expense_id) {
      stmts.push(
        env.DB.prepare('DELETE FROM expenses WHERE id = ?').bind(sub.expense_id)
      );
    }
    await env.DB.batch(stmts);

    return jsonOk({ success: true });
  } catch {
    return serverError();
  }
};
