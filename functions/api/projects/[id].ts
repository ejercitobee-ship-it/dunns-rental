import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../lib/session';
import { serializeProject, serializeTask } from '../../lib/serializers';
import { logActivityStmt } from '../../lib/activity';

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'tasks_view');
  if (auth instanceof Response) return auth;

  try {
    const id = params.id as string;

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

    if (!row) return jsonError('Project not found', 404);

    // Fetch the project's tasks
    const { results: taskRows } = await env.DB.prepare(
      `SELECT t.*,
        a.name AS assigned_to_name,
        c.name AS created_by_name,
        p.name AS project_name,
        prop.name AS property_name,
        u.unit_number,
        (ten.first_name || ' ' || ten.last_name) AS tenant_name,
        h.name AS vendor_name
      FROM tasks t
      LEFT JOIN user a ON a.id = t.assigned_to
      LEFT JOIN user c ON c.id = t.created_by
      LEFT JOIN projects p ON p.id = t.project_id
      LEFT JOIN properties prop ON prop.id = t.property_id
      LEFT JOIN units u ON u.id = t.unit_id
      LEFT JOIN tenants ten ON ten.id = t.tenant_id
      LEFT JOIN handymen h ON h.id = t.vendor_id
      WHERE t.project_id = ?
      ORDER BY
        CASE t.priority
          WHEN 'urgent' THEN 0
          WHEN 'high' THEN 1
          WHEN 'medium' THEN 2
          WHEN 'low' THEN 3
          ELSE 4
        END ASC,
        CASE WHEN t.due_date IS NULL THEN 1 ELSE 0 END ASC,
        t.due_date ASC,
        t.created_at DESC`
    ).bind(id).all();

    const tasks = (taskRows || []).map(r => serializeTask(r as Record<string, unknown>));

    return jsonOk({
      success: true,
      data: {
        project: serializeProject(row as Record<string, unknown>),
        tasks,
      },
    });
  } catch {
    return serverError();
  }
};

export const onRequestPut: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'projects_manage');
  if (auth instanceof Response) return auth;

  try {
    const id = params.id as string;
    const existing = await env.DB.prepare('SELECT * FROM projects WHERE id = ?').bind(id).first();
    if (!existing) return jsonError('Project not found', 404);

    const body = (await request.json()) as Record<string, unknown>;
    const now = Math.floor(Date.now() / 1000);

    await env.DB.batch([
      env.DB.prepare(
        `UPDATE projects SET
          name = ?, description = ?, status = ?, priority = ?,
          owner_id = ?, start_date = ?, due_date = ?, property_id = ?,
          updated_at = ?
        WHERE id = ?`
      ).bind(
        body.name ?? existing.name,
        body.description ?? existing.description ?? null,
        body.status ?? existing.status,
        body.priority ?? existing.priority,
        body.ownerId ?? existing.owner_id ?? null,
        body.startDate ?? existing.start_date ?? null,
        body.dueDate ?? existing.due_date ?? null,
        body.propertyId ?? existing.property_id ?? null,
        now,
        id,
      ),
      logActivityStmt(env.DB, auth, {
        module: 'tasks',
        action: 'Updated a project',
        targetType: 'projects',
        targetId: id,
        targetName: (body.name ?? existing.name) as string,
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

    return jsonOk({ success: true, data: serializeProject(row as Record<string, unknown>) });
  } catch {
    return serverError();
  }
};

export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'projects_manage');
  if (auth instanceof Response) return auth;

  try {
    const id = params.id as string;
    const existing = await env.DB.prepare('SELECT id, name FROM projects WHERE id = ?').bind(id).first();
    if (!existing) return jsonError('Project not found', 404);

    // Detach tasks from this project (set project_id to NULL), then delete the project
    await env.DB.batch([
      env.DB.prepare('UPDATE tasks SET project_id = NULL, updated_at = unixepoch() WHERE project_id = ?').bind(id),
      env.DB.prepare('DELETE FROM projects WHERE id = ?').bind(id),
      logActivityStmt(env.DB, auth, {
        module: 'tasks',
        action: 'Deleted a project',
        targetType: 'projects',
        targetId: id,
        targetName: existing.name as string,
      }),
    ]);

    return jsonOk({ success: true });
  } catch {
    return serverError();
  }
};
