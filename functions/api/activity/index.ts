import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, serverError } from '../../lib/session';

/**
 * GET /api/activity — the activity feed, newest first.
 *
 * Query params:
 *   limit, offset          — pagination (default 50, max 200)
 *   module                 — filter by module slug
 *   userId                 — filter by acting user
 *   propertyId             — filter by linked property
 *   tenantId               — filter by linked tenant
 *   targetType, targetId   — filter by the specific record
 *   search                 — full-text search in action + description + target_name + user_name
 *   dateFrom, dateTo       — unix-seconds range
 */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requirePermission(env, request, 'activity_view');
  if (auth instanceof Response) return auth;

  try {
    const url = new URL(request.url);
    const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 1), 200);
    const offset = Math.max(parseInt(url.searchParams.get('offset') || '0', 10) || 0, 0);

    const clauses: string[] = [];
    const binds: unknown[] = [];

    const module = url.searchParams.get('module');
    if (module) { clauses.push('module = ?'); binds.push(module); }

    const userId = url.searchParams.get('userId');
    if (userId) { clauses.push('user_id = ?'); binds.push(userId); }

    const propertyId = url.searchParams.get('propertyId');
    if (propertyId) { clauses.push('property_id = ?'); binds.push(propertyId); }

    const tenantId = url.searchParams.get('tenantId');
    if (tenantId) { clauses.push('tenant_id = ?'); binds.push(tenantId); }

    const targetType = url.searchParams.get('targetType');
    const targetId = url.searchParams.get('targetId');
    if (targetType && targetId) {
      clauses.push('target_type = ? AND target_id = ?');
      binds.push(targetType, targetId);
    } else if (targetType) {
      clauses.push('target_type = ?');
      binds.push(targetType);
    }

    const search = url.searchParams.get('search');
    if (search) {
      const q = `%${search}%`;
      clauses.push('(action LIKE ? OR description LIKE ? OR target_name LIKE ? OR user_name LIKE ?)');
      binds.push(q, q, q, q);
    }

    const dateFrom = url.searchParams.get('dateFrom');
    if (dateFrom) { clauses.push('created_at >= ?'); binds.push(Number(dateFrom)); }

    const dateTo = url.searchParams.get('dateTo');
    if (dateTo) { clauses.push('created_at <= ?'); binds.push(Number(dateTo)); }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    binds.push(limit, offset);

    const { results } = await env.DB.prepare(
      `SELECT id, user_id, user_name, user_role, module, action, description,
              target_type, target_id, target_name,
              property_id, unit_id, tenant_id,
              previous_values, new_values,
              method, status_code, created_at
         FROM activity_log
        ${where}
        ORDER BY created_at DESC, rowid DESC
        LIMIT ? OFFSET ?`
    )
      .bind(...binds)
      .all();

    // Also return total count for the current filter.
    const countResult = await env.DB.prepare(
      `SELECT COUNT(*) as total FROM activity_log ${where}`
    )
      .bind(...binds.slice(0, -2))  // exclude limit/offset
      .first<{ total: number }>();
    const total = countResult?.total ?? 0;

    const data = (results || []).map((r) => {
      const row = r as Record<string, unknown>;
      return {
        id: row.id,
        userId: row.user_id ?? undefined,
        userName: row.user_name ?? undefined,
        userRole: row.user_role ?? undefined,
        module: row.module ?? undefined,
        action: row.action,
        description: row.description ?? undefined,
        targetType: row.target_type ?? undefined,
        targetId: row.target_id ?? undefined,
        targetName: row.target_name ?? undefined,
        propertyId: row.property_id ?? undefined,
        unitId: row.unit_id ?? undefined,
        tenantId: row.tenant_id ?? undefined,
        previousValues: row.previous_values ? JSON.parse(row.previous_values as string) : undefined,
        newValues: row.new_values ? JSON.parse(row.new_values as string) : undefined,
        method: row.method,
        statusCode: row.status_code ?? undefined,
        createdAt: row.created_at,
      };
    });

    return jsonOk({ success: true, data, total });
  } catch {
    return serverError();
  }
};
