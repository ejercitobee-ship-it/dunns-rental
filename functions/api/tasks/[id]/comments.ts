import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../../lib/session';
import { serializeTaskComment } from '../../../lib/serializers';
import { createNotification } from '../../../lib/notify';

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'tasks_edit');
  if (auth instanceof Response) return auth;

  try {
    const taskId = params.id as string;

    const task = await env.DB.prepare('SELECT id, title, assigned_to, created_by FROM tasks WHERE id = ?').bind(taskId).first<{ id: string; title: string; assigned_to: string | null; created_by: string }>();
    if (!task) return jsonError('Task not found', 404);

    const body = (await request.json()) as Record<string, unknown>;
    if (!body.body || typeof body.body !== 'string') {
      return jsonError('Comment body is required', 400);
    }

    const id = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);
    const truncatedBody = (body.body as string).length > 100
      ? (body.body as string).substring(0, 100) + '...'
      : (body.body as string);

    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO task_comments (id, task_id, user_id, body, created_at)
         VALUES (?, ?, ?, ?, ?)`
      ).bind(id, taskId, auth.id, body.body, now),
      env.DB.prepare(
        `INSERT INTO task_activity (id, task_id, action, to_value, user_id, created_at)
         VALUES (?, ?, 'comment_added', ?, ?, ?)`
      ).bind(crypto.randomUUID(), taskId, truncatedBody, auth.id, now),
      env.DB.prepare('UPDATE tasks SET updated_at = ? WHERE id = ?').bind(now, taskId),
    ]);

    const row = await env.DB.prepare(
      `SELECT tc.*, u.name AS user_name
       FROM task_comments tc
       LEFT JOIN user u ON u.id = tc.user_id
       WHERE tc.id = ?`
    ).bind(id).first();

    const notifyIds = new Set<string>();
    if (task!.assigned_to && task!.assigned_to !== auth.id) notifyIds.add(task!.assigned_to);
    if (task!.created_by && task!.created_by !== auth.id) notifyIds.add(task!.created_by);
    for (const uid of notifyIds) {
      context.waitUntil(
        createNotification(env, {
          userId: uid,
          type: 'task',
          category: 'task_comment',
          title: 'New comment on task',
          message: `${task!.title}: ${truncatedBody}`,
          entityType: 'tasks',
          entityId: taskId,
          route: '/tasks',
        }).catch(() => {})
      );
    }

    return jsonOk({ success: true, data: serializeTaskComment(row as Record<string, unknown>) }, 201);
  } catch {
    return serverError();
  }
};
