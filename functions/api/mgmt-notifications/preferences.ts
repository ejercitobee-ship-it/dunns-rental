import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, serverError } from '../../lib/session';

const ALL_CATEGORIES = [
  'task_assigned',
  'task_completed',
  'task_comment',
  'project_created',
  'maintenance_new',
  'maintenance_completed',
  'maintenance_paid',
  'vendor_assigned',
  'tenant_message',
  'tenant_created',
  'tenant_converted',
  'lease_created',
  'lease_renewal',
  'lease_renewal_approved',
  'lease_renewal_rejected',
  'lease_status_changed',
  'payment_received',
  'payment_autopay',
  'expense_created',
  'deposit_return_created',
  'late_fee_assessed',
  'notice_created',
  'inspection_scheduled',
  'inspection_updated',
  'invoice_approved',
  'invoice_rejected',
  'approval_requested',
];

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requirePermission(env, request, 'dashboard_view');
  if (auth instanceof Response) return auth;

  try {
    const { results } = await env.DB.prepare(
      'SELECT category, enabled FROM mgmt_notification_preferences WHERE user_id = ?'
    ).bind(auth.id).all<{ category: string; enabled: number }>();

    const muted = new Set((results || []).filter(r => !r.enabled).map(r => r.category));
    const prefs: Record<string, boolean> = {};
    for (const cat of ALL_CATEGORIES) {
      prefs[cat] = !muted.has(cat);
    }

    return jsonOk({ preferences: prefs, categories: ALL_CATEGORIES });
  } catch {
    return serverError();
  }
};

export const onRequestPut: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requirePermission(env, request, 'dashboard_view');
  if (auth instanceof Response) return auth;

  try {
    const body = (await request.json()) as { preferences: Record<string, boolean> };
    const now = Math.floor(Date.now() / 1000);
    const stmts: D1PreparedStatement[] = [];

    for (const [category, enabled] of Object.entries(body.preferences || {})) {
      if (!ALL_CATEGORIES.includes(category)) continue;
      stmts.push(
        env.DB.prepare(
          `INSERT INTO mgmt_notification_preferences (id, user_id, category, enabled, updated_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(user_id, category) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at`
        ).bind(crypto.randomUUID(), auth.id, category, enabled ? 1 : 0, now)
      );
    }

    if (stmts.length) await env.DB.batch(stmts);
    return jsonOk({ success: true });
  } catch {
    return serverError();
  }
};
