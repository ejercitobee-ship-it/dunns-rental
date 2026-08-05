import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../../lib/session';
import { serializeCapitalProject, serializeExpense } from '../../../lib/serializers';

/**
 * GET    /api/capital-projects/:id — project detail with linked expenses.
 * PUT    /api/capital-projects/:id — update project metadata.
 * DELETE /api/capital-projects/:id — delete project (unlinks expenses, does NOT delete them).
 */

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'finances_view');
  if (auth instanceof Response) return auth;

  try {
    const id = params.id as string;
    const project = await env.DB.prepare('SELECT * FROM capital_projects WHERE id = ?').bind(id).first();
    if (!project) return jsonError('Project not found', 404);

    const { results: expenses } = await env.DB.prepare(
      `SELECT * FROM expenses WHERE capital_project_id = ? ORDER BY date DESC`
    ).bind(id).all();

    const totalCost = (expenses || []).reduce((s, e) => s + (Number(e.amount) || 0), 0);
    const serialized = serializeCapitalProject(project as Record<string, unknown>, totalCost, expenses?.length || 0);

    return jsonOk({
      success: true,
      data: {
        ...serialized,
        expenses: (expenses || []).map(e => serializeExpense(e as Record<string, unknown>)),
      },
    });
  } catch (err) {
    console.error('Capital project detail error:', err);
    return serverError();
  }
};

export const onRequestPut: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'finances_expenses');
  if (auth instanceof Response) return auth;

  try {
    const id = params.id as string;
    const existing = await env.DB.prepare('SELECT id FROM capital_projects WHERE id = ?').bind(id).first();
    if (!existing) return jsonError('Project not found', 404);

    const body = (await request.json()) as Record<string, unknown>;
    const sets: string[] = [];
    const vals: unknown[] = [];

    const fields: [string, string][] = [
      ['name', 'name'], ['description', 'description'], ['status', 'status'],
      ['startDate', 'start_date'], ['completionDate', 'completion_date'],
      ['budget', 'budget'], ['unitId', 'unit_id'], ['propertyId', 'property_id'],
    ];
    for (const [jsKey, dbCol] of fields) {
      if (jsKey in body) {
        sets.push(`${dbCol} = ?`);
        vals.push(body[jsKey] ?? null);
      }
    }
    if (sets.length === 0) return jsonError('Nothing to update.', 400);

    sets.push('updated_at = unixepoch()');
    vals.push(id);

    await env.DB.prepare(`UPDATE capital_projects SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();

    // Return updated project with totals
    const project = await env.DB.prepare('SELECT * FROM capital_projects WHERE id = ?').bind(id).first();
    const agg = await env.DB.prepare(
      `SELECT COALESCE(SUM(amount), 0) AS total_cost, COUNT(id) AS expense_count FROM expenses WHERE capital_project_id = ?`
    ).bind(id).first<{ total_cost: number; expense_count: number }>();

    return jsonOk({
      success: true,
      data: serializeCapitalProject(
        project as Record<string, unknown>,
        agg?.total_cost || 0,
        agg?.expense_count || 0,
      ),
    });
  } catch (err) {
    console.error('Capital project update error:', err);
    return serverError();
  }
};

export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'finances_expenses');
  if (auth instanceof Response) return auth;

  try {
    const id = params.id as string;
    const existing = await env.DB.prepare('SELECT id FROM capital_projects WHERE id = ?').bind(id).first();
    if (!existing) return jsonError('Project not found', 404);

    // Unlink expenses (don't delete them) and delete the project
    await env.DB.batch([
      env.DB.prepare('UPDATE expenses SET capital_project_id = NULL WHERE capital_project_id = ?').bind(id),
      env.DB.prepare('DELETE FROM capital_projects WHERE id = ?').bind(id),
    ]);

    return jsonOk({ success: true });
  } catch (err) {
    console.error('Capital project delete error:', err);
    return serverError();
  }
};
