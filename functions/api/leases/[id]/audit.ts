import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, serverError } from '../../../lib/session';

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'tenants_view');
  if (auth instanceof Response) return auth;

  try {
    const leaseId = params.id as string;
    const { results } = await env.DB.prepare(
      `SELECT id, lease_id, action, changed_by, changed_by_name, previous_data, new_data, notes, created_at
       FROM lease_audit_log WHERE lease_id = ? ORDER BY created_at DESC`
    ).bind(leaseId).all();

    const data = (results || []).map(r => ({
      id: r.id,
      leaseId: r.lease_id,
      action: r.action,
      changedBy: r.changed_by,
      changedByName: r.changed_by_name,
      previousData: r.previous_data ? JSON.parse(r.previous_data as string) : null,
      newData: r.new_data ? JSON.parse(r.new_data as string) : null,
      notes: r.notes,
      createdAt: r.created_at,
    }));

    return jsonOk({ success: true, data });
  } catch {
    return serverError();
  }
};
