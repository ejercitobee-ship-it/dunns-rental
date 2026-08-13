import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../lib/session';
import { logActivityStmt } from '../../lib/activity';

/**
 * PUT /api/announcements/:id — edit an announcement's title, body, and/or
 * expiration. Because announcements are stored as one row per property, we
 * update every row that shares the same (title, body, created_by, created_at)
 * group so the edit applies to the whole logical announcement.
 *
 * Body: { title?: string, body?: string, expiresAt?: string | null }
 */
export const onRequestPut: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'announcements_send');
  if (auth instanceof Response) return auth;

  try {
    const id = params.id as string;
    const existing = await env.DB.prepare(
      'SELECT id, title, body, created_by, created_at FROM announcements WHERE id = ?'
    ).bind(id).first<{ id: string; title: string; body: string; created_by: string; created_at: number }>();
    if (!existing) return jsonError('Announcement not found', 404);

    const input = (await request.json()) as Record<string, unknown>;
    const newTitle = typeof input.title === 'string' ? input.title.trim() : existing.title;
    const newBody = typeof input.body === 'string' ? input.body.trim() : existing.body;
    const newExpires = input.expiresAt === null ? null
      : typeof input.expiresAt === 'string' ? input.expiresAt
      : undefined; // undefined = don't change

    if (!newTitle) return jsonError('Title is required', 400);
    if (!newBody) return jsonError('Message body is required', 400);

    // Update all rows in the same logical group.
    const setClauses = ['title = ?', 'body = ?'];
    const binds: (string | null)[] = [newTitle, newBody];
    if (newExpires !== undefined) {
      setClauses.push('expires_at = ?');
      binds.push(newExpires);
    }

    const stmts = [
      env.DB.prepare(
        `UPDATE announcements SET ${setClauses.join(', ')}
          WHERE title = ? AND body = ? AND created_by = ? AND created_at = ?`
      ).bind(...binds, existing.title, existing.body, existing.created_by, existing.created_at),
      logActivityStmt(env.DB, auth, {
        module: 'settings',
        action: 'Edited announcement',
        description: `"${newTitle}"`,
      }),
    ];
    await env.DB.batch(stmts);

    return jsonOk({ success: true });
  } catch {
    return serverError();
  }
};

/** DELETE /api/announcements/:id — remove a past announcement. */
export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'announcements_send');
  if (auth instanceof Response) return auth;

  try {
    const id = params.id as string;
    const existing = await env.DB.prepare('SELECT title FROM announcements WHERE id = ?')
      .bind(id).first<{ title: string }>();
    if (!existing) return jsonError('Announcement not found', 404);

    await env.DB.batch([
      env.DB.prepare('DELETE FROM announcements WHERE id = ?').bind(id),
      logActivityStmt(env.DB, auth, {
        module: 'settings',
        action: 'Deleted announcement',
        description: `"${existing.title}"`,
      }),
    ]);

    return jsonOk({ success: true });
  } catch {
    return serverError();
  }
};
