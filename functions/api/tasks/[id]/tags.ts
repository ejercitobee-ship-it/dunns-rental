import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../../lib/session';

export const onRequestPut: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'tasks_edit');
  if (auth instanceof Response) return auth;

  try {
    const taskId = params.id as string;

    // Verify the task exists
    const task = await env.DB.prepare('SELECT id FROM tasks WHERE id = ?').bind(taskId).first();
    if (!task) return jsonError('Task not found', 404);

    const body = (await request.json()) as Record<string, unknown>;
    if (!Array.isArray(body.tags)) {
      return jsonError('tags must be an array of tag names', 400);
    }

    const tagNames = (body.tags as string[]).filter(Boolean);

    // Ensure each tag exists and collect ids
    const tagIds: string[] = [];
    for (const name of tagNames) {
      // Insert if not exists
      await env.DB.prepare(
        'INSERT OR IGNORE INTO task_tags (id, name) VALUES (?, ?)'
      ).bind(crypto.randomUUID(), name).run();

      // Get the tag id
      const tag = await env.DB.prepare(
        'SELECT id FROM task_tags WHERE name = ?'
      ).bind(name).first<{ id: string }>();

      if (tag) tagIds.push(tag.id);
    }

    // Replace all tag assignments for this task
    await env.DB.prepare('DELETE FROM task_tag_assignments WHERE task_id = ?').bind(taskId).run();

    if (tagIds.length > 0) {
      const values = tagIds.map(() => '(?, ?)').join(', ');
      const binds: string[] = [];
      for (const tagId of tagIds) {
        binds.push(taskId, tagId);
      }
      await env.DB.prepare(
        `INSERT INTO task_tag_assignments (task_id, tag_id) VALUES ${values}`
      ).bind(...binds).run();
    }

    // Return the task's current tags
    const { results } = await env.DB.prepare(
      `SELECT tt.* FROM task_tags tt
       JOIN task_tag_assignments tta ON tta.tag_id = tt.id
       WHERE tta.task_id = ?`
    ).bind(taskId).all();

    const tags = (results || []).map(r => ({ id: r.id, name: r.name }));
    return jsonOk({ success: true, data: tags });
  } catch {
    return serverError();
  }
};
