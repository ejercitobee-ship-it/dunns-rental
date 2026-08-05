import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../../lib/session';

/**
 * POST   /api/capital-projects/:id/expenses — link expenses to this project.
 * DELETE /api/capital-projects/:id/expenses — unlink expenses from this project.
 *
 * Body: { expenseIds: string[] }
 */

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'finances_expenses');
  if (auth instanceof Response) return auth;

  try {
    const projectId = params.id as string;
    const project = await env.DB.prepare('SELECT id FROM capital_projects WHERE id = ?').bind(projectId).first();
    if (!project) return jsonError('Project not found', 404);

    const body = (await request.json()) as { expenseIds?: string[] };
    const ids = body.expenseIds;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return jsonError('expenseIds is required.', 400);
    }

    const stmts = ids.map(eid =>
      env.DB.prepare(
        'UPDATE expenses SET capital_project_id = ?, updated_at = unixepoch() WHERE id = ?'
      ).bind(projectId, eid)
    );
    await env.DB.batch(stmts);

    // Return updated totals
    const agg = await env.DB.prepare(
      `SELECT COALESCE(SUM(amount), 0) AS total_cost, COUNT(id) AS cnt FROM expenses WHERE capital_project_id = ?`
    ).bind(projectId).first<{ total_cost: number; cnt: number }>();

    return jsonOk({
      success: true,
      data: { linked: ids.length, totalCost: agg?.total_cost || 0, expenseCount: agg?.cnt || 0 },
    });
  } catch (err) {
    console.error('Link expenses error:', err);
    return serverError();
  }
};

export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'finances_expenses');
  if (auth instanceof Response) return auth;

  try {
    const projectId = params.id as string;
    const project = await env.DB.prepare('SELECT id FROM capital_projects WHERE id = ?').bind(projectId).first();
    if (!project) return jsonError('Project not found', 404);

    const body = (await request.json()) as { expenseIds?: string[] };
    const ids = body.expenseIds;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return jsonError('expenseIds is required.', 400);
    }

    const stmts = ids.map(eid =>
      env.DB.prepare(
        'UPDATE expenses SET capital_project_id = NULL, updated_at = unixepoch() WHERE id = ? AND capital_project_id = ?'
      ).bind(eid, projectId)
    );
    await env.DB.batch(stmts);

    return jsonOk({ success: true, data: { unlinked: ids.length } });
  } catch (err) {
    console.error('Unlink expenses error:', err);
    return serverError();
  }
};
