import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, serverError } from '../../lib/session';

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requirePermission(env, request, 'tasks_view');
  if (auth instanceof Response) return auth;

  try {
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    // First day of current month
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

    // 7 days from now
    const future = new Date(now);
    future.setDate(future.getDate() + 7);
    const weekEnd = `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, '0')}-${String(future.getDate()).padStart(2, '0')}`;

    const row = await env.DB.prepare(
      `SELECT
        SUM(CASE WHEN status NOT IN ('completed', 'cancelled') THEN 1 ELSE 0 END) AS open,
        SUM(CASE WHEN due_date < ? AND status NOT IN ('completed', 'cancelled') THEN 1 ELSE 0 END) AS overdue,
        SUM(CASE WHEN due_date = ? AND status NOT IN ('completed', 'cancelled') THEN 1 ELSE 0 END) AS due_today,
        SUM(CASE WHEN due_date >= ? AND due_date <= ? AND status NOT IN ('completed', 'cancelled') THEN 1 ELSE 0 END) AS due_this_week,
        SUM(CASE WHEN status = 'completed' AND completed_at >= unixepoch(?) THEN 1 ELSE 0 END) AS completed_this_month,
        SUM(CASE WHEN assigned_to = ? AND status NOT IN ('completed', 'cancelled') THEN 1 ELSE 0 END) AS my_open,
        SUM(CASE WHEN assigned_to = ? AND due_date < ? AND status NOT IN ('completed', 'cancelled') THEN 1 ELSE 0 END) AS my_overdue,
        SUM(CASE WHEN status = 'waiting' THEN 1 ELSE 0 END) AS waiting
      FROM tasks`
    ).bind(today, today, today, weekEnd, monthStart, auth.id, auth.id, today).first();

    // Active projects count
    const projRow = await env.DB.prepare(
      "SELECT COUNT(*) AS cnt FROM projects WHERE status = 'active'"
    ).first<{ cnt: number }>();

    const r = (row || {}) as Record<string, unknown>;
    return jsonOk({
      success: true,
      data: {
        open: r.open ?? 0,
        overdue: r.overdue ?? 0,
        dueToday: r.due_today ?? 0,
        dueThisWeek: r.due_this_week ?? 0,
        completedThisMonth: r.completed_this_month ?? 0,
        activeProjects: projRow?.cnt ?? 0,
        myOpen: r.my_open ?? 0,
        myOverdue: r.my_overdue ?? 0,
        waiting: r.waiting ?? 0,
      },
    });
  } catch {
    return serverError();
  }
};
