import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../lib/session';
import { serializeCapitalProject } from '../../lib/serializers';

/**
 * GET  /api/capital-projects — list all capital projects with rollup totals.
 * POST /api/capital-projects — create a new capital project.
 */

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requirePermission(env, request, 'finances_view');
  if (auth instanceof Response) return auth;

  try {
    const { results: projects } = await env.DB.prepare(
      `SELECT cp.*,
              COALESCE(SUM(e.amount), 0) AS total_cost,
              COUNT(e.id) AS expense_count
       FROM capital_projects cp
       LEFT JOIN expenses e ON e.capital_project_id = cp.id
       GROUP BY cp.id
       ORDER BY cp.created_at DESC`
    ).all();

    return jsonOk({
      success: true,
      data: (projects || []).map(p =>
        serializeCapitalProject(
          p as Record<string, unknown>,
          Number(p.total_cost) || 0,
          Number(p.expense_count) || 0,
        )
      ),
    });
  } catch (err) {
    console.error('Capital projects list error:', err);
    return serverError();
  }
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requirePermission(env, request, 'finances_expenses');
  if (auth instanceof Response) return auth;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const name = (body.name as string || '').trim();
    if (!name) return jsonError('Project name is required.', 400);
    const propertyId = body.propertyId as string;
    if (!propertyId) return jsonError('Property is required.', 400);

    // Verify property exists
    const prop = await env.DB.prepare('SELECT id FROM properties WHERE id = ?').bind(propertyId).first();
    if (!prop) return jsonError('Property not found.', 404);

    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO capital_projects (id, name, property_id, unit_id, description, status, start_date, completion_date, budget, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id,
      name,
      propertyId,
      body.unitId ?? null,
      body.description ?? null,
      body.status ?? 'in_progress',
      body.startDate ?? null,
      body.completionDate ?? null,
      body.budget ?? null,
      auth.id,
    ).run();

    const row = await env.DB.prepare('SELECT * FROM capital_projects WHERE id = ?').bind(id).first();
    return jsonOk({ success: true, data: serializeCapitalProject(row as Record<string, unknown>) }, 201);
  } catch (err) {
    console.error('Capital project create error:', err);
    return serverError();
  }
};
