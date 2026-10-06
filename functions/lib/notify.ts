import type { Env } from './session';

export interface NotifyParams {
  userId: string;
  type: string;
  category: string;
  priority?: 'informational' | 'normal' | 'important' | 'urgent';
  title: string;
  message?: string;
  entityType?: string;
  entityId?: string;
  route?: string;
}

export function createNotificationStmt(
  db: D1Database,
  params: NotifyParams,
): D1PreparedStatement {
  return db.prepare(
    `INSERT INTO mgmt_notifications (id, user_id, type, category, priority, title, message, entity_type, entity_id, route, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    crypto.randomUUID(),
    params.userId,
    params.type,
    params.category,
    params.priority || 'normal',
    params.title,
    params.message || null,
    params.entityType || null,
    params.entityId || null,
    params.route || null,
    Math.floor(Date.now() / 1000),
  );
}

export async function createNotification(
  env: Env,
  params: NotifyParams,
): Promise<void> {
  const filtered = await filterByPreferences(env, [params]);
  if (filtered.length === 0) return;
  await createNotificationStmt(env.DB, params).run();
}

async function filterByPreferences(
  env: Env,
  paramsList: NotifyParams[],
): Promise<NotifyParams[]> {
  if (paramsList.length === 0) return [];
  const userIds = [...new Set(paramsList.map(p => p.userId))];
  const categories = [...new Set(paramsList.map(p => p.category))];
  if (!userIds.length || !categories.length) return paramsList;

  const placeholders = userIds.map(() => '?').join(',');
  const catPlaceholders = categories.map(() => '?').join(',');
  const { results } = await env.DB.prepare(
    `SELECT user_id, category FROM mgmt_notification_preferences
     WHERE user_id IN (${placeholders}) AND category IN (${catPlaceholders}) AND enabled = 0`
  ).bind(...userIds, ...categories).all<{ user_id: string; category: string }>();

  if (!results || results.length === 0) return paramsList;
  const muted = new Set(results.map(r => `${r.user_id}:${r.category}`));
  return paramsList.filter(p => !muted.has(`${p.userId}:${p.category}`));
}

export async function notifyMultiple(
  env: Env,
  paramsList: NotifyParams[],
): Promise<void> {
  if (paramsList.length === 0) return;
  const filtered = await filterByPreferences(env, paramsList);
  if (filtered.length === 0) return;
  const stmts = filtered.map(p => createNotificationStmt(env.DB, p));
  await env.DB.batch(stmts);
}

export async function getManagementUserIds(env: Env, excludeUserId?: string): Promise<string[]> {
  const rows = await env.DB.prepare(
    `SELECT id FROM user WHERE role IN ('super_admin','admin','manager','accountant','viewer') AND id != ?`
  ).bind(excludeUserId || '').all<{ id: string }>();
  return (rows.results || []).map(r => r.id);
}
