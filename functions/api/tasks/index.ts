import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../lib/session';
import { serializeTask } from '../../lib/serializers';
import { logActivityStmt } from '../../lib/activity';

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requirePermission(env, request, 'tasks_view');
  if (auth instanceof Response) return auth;

  try {
    const url = new URL(request.url);
    const view = url.searchParams.get('view');
    const statusFilter = url.searchParams.get('status');
    const priorityFilter = url.searchParams.get('priority');
    const categoryFilter = url.searchParams.get('category');
    const projectId = url.searchParams.get('project_id');
    const propertyId = url.searchParams.get('property_id');
    const assignedTo = url.searchParams.get('assigned_to');
    const due = url.searchParams.get('due');
    const search = url.searchParams.get('search');

    const conditions: string[] = [];
    const binds: unknown[] = [];

    // View filters
    if (view === 'my') {
      conditions.push('t.assigned_to = ?');
      binds.push(auth.id);
    } else if (view === 'unassigned') {
      conditions.push("t.assigned_to IS NULL AND t.status NOT IN ('completed', 'cancelled')");
    }

    // Status filter (comma-separated)
    if (statusFilter) {
      const statuses = statusFilter.split(',').map(s => s.trim()).filter(Boolean);
      if (statuses.length > 0) {
        conditions.push(`t.status IN (${statuses.map(() => '?').join(',')})`);
        binds.push(...statuses);
      }
    }

    // Priority filter (comma-separated)
    if (priorityFilter) {
      const priorities = priorityFilter.split(',').map(s => s.trim()).filter(Boolean);
      if (priorities.length > 0) {
        conditions.push(`t.priority IN (${priorities.map(() => '?').join(',')})`);
        binds.push(...priorities);
      }
    }

    // Category filter (comma-separated)
    if (categoryFilter) {
      const categories = categoryFilter.split(',').map(s => s.trim()).filter(Boolean);
      if (categories.length > 0) {
        conditions.push(`t.category IN (${categories.map(() => '?').join(',')})`);
        binds.push(...categories);
      }
    }

    // Exact-match filters
    if (projectId) {
      conditions.push('t.project_id = ?');
      binds.push(projectId);
    }
    if (propertyId) {
      conditions.push('t.property_id = ?');
      binds.push(propertyId);
    }
    if (assignedTo) {
      conditions.push('t.assigned_to = ?');
      binds.push(assignedTo);
    }

    // Due date filters — compute today in YYYY-MM-DD format
    if (due) {
      const now = new Date();
      const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      if (due === 'today') {
        conditions.push("t.due_date = ? AND t.status NOT IN ('completed', 'cancelled')");
        binds.push(today);
      } else if (due === 'overdue') {
        conditions.push("t.due_date < ? AND t.status NOT IN ('completed', 'cancelled')");
        binds.push(today);
      } else if (due === 'upcoming') {
        // Next 7 days (inclusive of today)
        const future = new Date(now);
        future.setDate(future.getDate() + 7);
        const futureStr = `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, '0')}-${String(future.getDate()).padStart(2, '0')}`;
        conditions.push("t.due_date >= ? AND t.due_date <= ? AND t.status NOT IN ('completed', 'cancelled')");
        binds.push(today, futureStr);
      }
    }

    // Search filter
    if (search) {
      conditions.push('t.title LIKE ?');
      binds.push(`%${search}%`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const sql = `
      SELECT t.*,
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
      ${where}
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
        t.created_at DESC
    `;

    const stmt = binds.length > 0
      ? env.DB.prepare(sql).bind(...binds)
      : env.DB.prepare(sql);
    const { results } = await stmt.all();
    const data = (results || []).map(r => serializeTask(r as Record<string, unknown>));
    return jsonOk({ success: true, data });
  } catch {
    return serverError();
  }
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requirePermission(env, request, 'tasks_create');
  if (auth instanceof Response) return auth;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    if (!body.title || !body.category || !body.priority || !body.status) {
      return jsonError('Title, category, priority, and status are required', 400);
    }

    const id = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);

    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO tasks
          (id, title, description, category, status, priority, waiting_for,
           assigned_to, created_by, due_date, due_time, start_date,
           estimated_minutes, actual_minutes, project_id, property_id, unit_id,
           tenant_id, vendor_id, lease_id, maintenance_request_id, expense_id,
           inspection_id, requires_approval, approval_status, is_recurring,
           recurrence_rule, recurrence_end_date, parent_task_id,
           created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?,
                 ?, ?, ?, ?, ?,
                 ?, ?, ?, ?, ?,
                 ?, ?, ?, ?, ?,
                 ?, ?, ?, ?,
                 ?, ?, ?,
                 ?, ?)`
      ).bind(
        id,
        body.title,
        body.description ?? null,
        body.category,
        body.status,
        body.priority,
        body.waitingFor ?? null,
        body.assignedTo ?? null,
        auth.id,
        body.dueDate ?? null,
        body.dueTime ?? null,
        body.startDate ?? null,
        body.estimatedMinutes ?? null,
        body.actualMinutes ?? null,
        body.projectId ?? null,
        body.propertyId ?? null,
        body.unitId ?? null,
        body.tenantId ?? null,
        body.vendorId ?? null,
        body.leaseId ?? null,
        body.maintenanceRequestId ?? null,
        body.expenseId ?? null,
        body.inspectionId ?? null,
        body.requiresApproval ? 1 : 0,
        body.requiresApproval ? 'pending' : 'not_required',
        body.isRecurring ? 1 : 0,
        body.recurrenceRule ?? null,
        body.recurrenceEndDate ?? null,
        body.parentTaskId ?? null,
        now,
        now,
      ),
      env.DB.prepare(
        `INSERT INTO task_activity (id, task_id, action, user_id, created_at)
         VALUES (?, ?, 'created', ?, ?)`
      ).bind(crypto.randomUUID(), id, auth.id, now),
      logActivityStmt(env.DB, auth, {
        module: 'tasks',
        action: 'Created a task',
        targetType: 'tasks',
        targetId: id,
        targetName: body.title as string,
      }),
    ]);

    // Re-fetch with JOINs for names
    const row = await env.DB.prepare(
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
      WHERE t.id = ?`
    ).bind(id).first();

    return jsonOk({ success: true, data: serializeTask(row as Record<string, unknown>) }, 201);
  } catch {
    return serverError();
  }
};
