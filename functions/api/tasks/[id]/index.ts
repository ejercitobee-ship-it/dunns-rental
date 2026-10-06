import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../../lib/session';
import { serializeTask, serializeTaskComment, serializeTaskActivity } from '../../../lib/serializers';
import { logActivityStmt } from '../../../lib/activity';
import { createNotification } from '../../../lib/notify';

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'tasks_view');
  if (auth instanceof Response) return auth;

  try {
    const id = params.id as string;

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

    if (!row) return jsonError('Task not found', 404);

    // Fetch tags
    const { results: tagRows } = await env.DB.prepare(
      `SELECT tt.* FROM task_tags tt
       JOIN task_tag_assignments tta ON tta.tag_id = tt.id
       WHERE tta.task_id = ?`
    ).bind(id).all();
    const tags = (tagRows || []).map(r => ({ id: r.id, name: r.name }));

    // Fetch comments with user names
    const { results: commentRows } = await env.DB.prepare(
      `SELECT tc.*, u.name AS user_name
       FROM task_comments tc
       LEFT JOIN user u ON u.id = tc.user_id
       WHERE tc.task_id = ?
       ORDER BY tc.created_at ASC`
    ).bind(id).all();
    const comments = (commentRows || []).map(r => serializeTaskComment(r as Record<string, unknown>));

    // Fetch activity with user names
    const { results: activityRows } = await env.DB.prepare(
      `SELECT ta.*, u.name AS user_name
       FROM task_activity ta
       LEFT JOIN user u ON u.id = ta.user_id
       WHERE ta.task_id = ?
       ORDER BY ta.created_at DESC`
    ).bind(id).all();
    const activity = (activityRows || []).map(r => serializeTaskActivity(r as Record<string, unknown>));

    return jsonOk({
      success: true,
      data: {
        task: serializeTask(row as Record<string, unknown>),
        tags,
        comments,
        activity,
      },
    });
  } catch {
    return serverError();
  }
};

export const onRequestPut: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'tasks_edit');
  if (auth instanceof Response) return auth;

  try {
    const id = params.id as string;
    const existing = await env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(id).first();
    if (!existing) return jsonError('Task not found', 404);

    const body = (await request.json()) as Record<string, unknown>;
    const now = Math.floor(Date.now() / 1000);

    // If moving to waiting status, require waiting_for
    const newStatus = (body.status as string) ?? (existing.status as string);
    if (newStatus === 'waiting' && !body.waitingFor && !existing.waiting_for) {
      return jsonError('waiting_for is required when status is waiting', 400);
    }

    // Compute completed_at / completed_by
    const wasCompleted = existing.status === 'completed';
    const isCompleted = newStatus === 'completed';
    const completedAt = isCompleted ? (wasCompleted ? existing.completed_at : now) : null;
    const completedBy = isCompleted ? (wasCompleted ? existing.completed_by : auth.id) : null;

    // Track changes for task_activity
    const activityStmts: ReturnType<typeof env.DB.prepare>[] = [];
    const trackChange = (field: string, oldVal: unknown, newVal: unknown) => {
      if (String(oldVal ?? '') !== String(newVal ?? '')) {
        activityStmts.push(
          env.DB.prepare(
            `INSERT INTO task_activity (id, task_id, action, from_value, to_value, user_id, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
          ).bind(
            crypto.randomUUID(), id, `${field}_changed`,
            oldVal != null ? String(oldVal) : null,
            newVal != null ? String(newVal) : null,
            auth.id, now,
          )
        );
      }
    };

    trackChange('status', existing.status, newStatus);
    trackChange('priority', existing.priority, body.priority ?? existing.priority);
    trackChange('assigned_to', existing.assigned_to, body.assignedTo ?? existing.assigned_to);
    trackChange('due_date', existing.due_date, body.dueDate ?? existing.due_date);
    trackChange('category', existing.category, body.category ?? existing.category);

    const stmts = [
      env.DB.prepare(
        `UPDATE tasks SET
          title = ?, description = ?, category = ?, status = ?, priority = ?,
          waiting_for = ?, assigned_to = ?, due_date = ?, due_time = ?,
          start_date = ?, estimated_minutes = ?, actual_minutes = ?,
          project_id = ?, property_id = ?, unit_id = ?, tenant_id = ?,
          vendor_id = ?, lease_id = ?, maintenance_request_id = ?,
          expense_id = ?, inspection_id = ?,
          requires_approval = ?, approval_status = ?,
          is_recurring = ?, recurrence_rule = ?, recurrence_end_date = ?,
          parent_task_id = ?,
          completed_at = ?, completed_by = ?,
          updated_at = ?
        WHERE id = ?`
      ).bind(
        body.title ?? existing.title,
        body.description ?? existing.description ?? null,
        body.category ?? existing.category,
        newStatus,
        body.priority ?? existing.priority,
        body.waitingFor ?? existing.waiting_for ?? null,
        body.assignedTo ?? existing.assigned_to ?? null,
        body.dueDate ?? existing.due_date ?? null,
        body.dueTime ?? existing.due_time ?? null,
        body.startDate ?? existing.start_date ?? null,
        body.estimatedMinutes ?? existing.estimated_minutes ?? null,
        body.actualMinutes ?? existing.actual_minutes ?? null,
        body.projectId ?? existing.project_id ?? null,
        body.propertyId ?? existing.property_id ?? null,
        body.unitId ?? existing.unit_id ?? null,
        body.tenantId ?? existing.tenant_id ?? null,
        body.vendorId ?? existing.vendor_id ?? null,
        body.leaseId ?? existing.lease_id ?? null,
        body.maintenanceRequestId ?? existing.maintenance_request_id ?? null,
        body.expenseId ?? existing.expense_id ?? null,
        body.inspectionId ?? existing.inspection_id ?? null,
        body.requiresApproval != null ? (body.requiresApproval ? 1 : 0) : (existing.requires_approval ?? 0),
        body.approvalStatus ?? existing.approval_status ?? 'not_required',
        body.isRecurring != null ? (body.isRecurring ? 1 : 0) : (existing.is_recurring ?? 0),
        body.recurrenceRule ?? existing.recurrence_rule ?? null,
        body.recurrenceEndDate ?? existing.recurrence_end_date ?? null,
        body.parentTaskId ?? existing.parent_task_id ?? null,
        completedAt,
        completedBy,
        now,
        id,
      ),
      ...activityStmts,
      logActivityStmt(env.DB, auth, {
        module: 'tasks',
        action: 'Updated a task',
        targetType: 'tasks',
        targetId: id,
        targetName: (body.title ?? existing.title) as string,
      }),
    ];

    await env.DB.batch(stmts);

    const taskTitle = (body.title ?? existing.title) as string;
    const assignedTo = (body.assignedTo ?? existing.assigned_to) as string | null;

    if (newStatus !== existing.status && newStatus === 'completed' && assignedTo && assignedTo !== auth.id) {
      context.waitUntil(
        createNotification(env, {
          userId: auth.id,
          type: 'task',
          category: 'task_completed',
          title: 'Task completed',
          message: taskTitle,
          entityType: 'tasks',
          entityId: id,
          route: '/tasks',
        }).catch(() => {})
      );
    }

    if (body.assignedTo && body.assignedTo !== existing.assigned_to && body.assignedTo !== auth.id) {
      context.waitUntil(
        createNotification(env, {
          userId: body.assignedTo as string,
          type: 'task',
          category: 'task_assigned',
          title: 'Task assigned to you',
          message: taskTitle,
          entityType: 'tasks',
          entityId: id,
          route: '/tasks',
        }).catch(() => {})
      );
    }

    // Re-fetch with JOINs
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

    return jsonOk({ success: true, data: serializeTask(row as Record<string, unknown>) });
  } catch {
    return serverError();
  }
};

export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'tasks_delete');
  if (auth instanceof Response) return auth;

  try {
    const id = params.id as string;
    const existing = await env.DB.prepare('SELECT id, title FROM tasks WHERE id = ?').bind(id).first();
    if (!existing) return jsonError('Task not found', 404);

    await env.DB.batch([
      env.DB.prepare('DELETE FROM task_tag_assignments WHERE task_id = ?').bind(id),
      env.DB.prepare('DELETE FROM task_comments WHERE task_id = ?').bind(id),
      env.DB.prepare('DELETE FROM task_activity WHERE task_id = ?').bind(id),
      env.DB.prepare('DELETE FROM tasks WHERE id = ?').bind(id),
      logActivityStmt(env.DB, auth, {
        module: 'tasks',
        action: 'Deleted a task',
        targetType: 'tasks',
        targetId: id,
        targetName: existing.title as string,
      }),
    ]);

    return jsonOk({ success: true });
  } catch {
    return serverError();
  }
};
