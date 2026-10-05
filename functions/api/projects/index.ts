import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../lib/session';
import { serializeProject } from '../../lib/serializers';
import { logActivityStmt } from '../../lib/activity';

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requirePermission(env, request, 'tasks_view');
  if (auth instanceof Response) return auth;

  try {
    const { results } = await env.DB.prepare(
      `SELECT p.*,
        o.name AS owner_name,
        c.name AS created_by_name,
        prop.name AS property_name,
        (SELECT COUNT(*) FROM tasks WHERE project_id = p.id) AS task_count,
        (SELECT COUNT(*) FROM tasks WHERE project_id = p.id AND status = 'completed') AS completed_count
      FROM projects p
      LEFT JOIN user o ON o.id = p.owner_id
      LEFT JOIN user c ON c.id = p.created_by
      LEFT JOIN properties prop ON prop.id = p.property_id
      ORDER BY
        CASE p.status
          WHEN 'active' THEN 0
          WHEN 'on_hold' THEN 1
          WHEN 'completed' THEN 2
          WHEN 'cancelled' THEN 3
          ELSE 4
        END ASC,
        CASE WHEN p.due_date IS NULL THEN 1 ELSE 0 END ASC,
        p.due_date ASC`
    ).all();

    const data = (results || []).map(r => serializeProject(r as Record<string, unknown>));
    return jsonOk({ success: true, data });
  } catch {
    return serverError();
  }
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requirePermission(env, request, 'projects_manage');
  if (auth instanceof Response) return auth;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    if (!body.name) {
      return jsonError('Project name is required', 400);
    }

    const id = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);

    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO projects
          (id, name, description, status, priority, owner_id, start_date,
           due_date, property_id, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        id,
        body.name,
        body.description ?? null,
        body.status ?? 'active',
        body.priority ?? 'medium',
        body.ownerId ?? auth.id,
        body.startDate ?? null,
        body.dueDate ?? null,
        body.propertyId ?? null,
        auth.id,
        now,
        now,
      ),
      logActivityStmt(env.DB, auth, {
        module: 'tasks',
        action: 'Created a project',
        targetType: 'projects',
        targetId: id,
        targetName: body.name as string,
      }),
    ]);

    // Re-fetch with JOINs
    const row = await env.DB.prepare(
      `SELECT p.*,
        o.name AS owner_name,
        c.name AS created_by_name,
        prop.name AS property_name,
        (SELECT COUNT(*) FROM tasks WHERE project_id = p.id) AS task_count,
        (SELECT COUNT(*) FROM tasks WHERE project_id = p.id AND status = 'completed') AS completed_count
      FROM projects p
      LEFT JOIN user o ON o.id = p.owner_id
      LEFT JOIN user c ON c.id = p.created_by
      LEFT JOIN properties prop ON prop.id = p.property_id
      WHERE p.id = ?`
    ).bind(id).first();

    return jsonOk({ success: true, data: serializeProject(row as Record<string, unknown>) }, 201);
  } catch {
    return serverError();
  }
};
