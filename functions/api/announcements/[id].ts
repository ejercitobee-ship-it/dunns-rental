import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../lib/session';
import { logActivityStmt } from '../../lib/activity';

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
