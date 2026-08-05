import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../../lib/session';
import { serializeMaintenance } from '../../../lib/serializers';
import { maintenanceExpenseId } from '../../../lib/maintenance';

/**
 * POST /api/maintenance/:id/pay — the admin records paying the handyman. Sets
 * the cost, stamps paid_at with today, moves the job to paid, and writes a real
 * row into the expenses table so the payment shows up in Finances, on the
 * Dashboard, and in the per-property breakdowns exactly like any other expense,
 * with no separate aggregation to keep in sync. The expense id is derived from
 * the request id, so re-recording a payment updates the same row instead of
 * duplicating it. The app never moves money; this only records it. The cost
 * never touches the tenant's rent ledger.
 */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'properties_edit');
  if (auth instanceof Response) return auth;

  try {
    const id = params.id as string;
    const body = (await request.json()) as Record<string, unknown>;
    const cost = Number(body.cost);
    if (!Number.isFinite(cost) || cost < 0) return jsonError('Enter a valid amount', 400);

    const req = await env.DB.prepare(
      'SELECT status, title, property_id, unit_id, assigned_handyman_id FROM maintenance_requests WHERE id = ?'
    )
      .bind(id)
      .first<{ status: string; title: string; property_id: string | null; unit_id: string | null; assigned_handyman_id: string | null }>();
    if (!req) return jsonError('Request not found', 404);
    if (req.status === 'cancelled') return jsonError('This request was cancelled', 400);

    const vendor = req.assigned_handyman_id
      ? (await env.DB.prepare('SELECT COALESCE(company_name, name) AS name FROM handymen WHERE id = ?').bind(req.assigned_handyman_id).first<{ name: string }>())?.name ?? null
      : null;

    const today = new Date().toISOString().slice(0, 10);
    const expenseId = maintenanceExpenseId(id);

    await env.DB.batch([
      env.DB.prepare(
        `UPDATE maintenance_requests
            SET cost = ?, status = 'paid', paid_at = ?, resolved_date = COALESCE(resolved_date, ?), updated_at = unixepoch()
          WHERE id = ?`
      ).bind(cost, today, today, id),
      // One expense per request (id derived from the request), upserted so a
      // corrected payment updates rather than duplicates.
      env.DB.prepare(
        `INSERT INTO expenses (id, property_id, unit_id, category, amount, date, description, vendor, is_recurring, user_id)
         VALUES (?, ?, ?, 'maintenance', ?, ?, ?, ?, 0, ?)
         ON CONFLICT(id) DO UPDATE SET
           amount = excluded.amount, date = excluded.date, description = excluded.description,
           vendor = excluded.vendor, property_id = excluded.property_id, unit_id = excluded.unit_id,
           updated_at = unixepoch()`
      ).bind(
        expenseId,
        req.property_id,
        req.unit_id,
        cost,
        today,
        `Maintenance: ${req.title}`,
        vendor,
        auth.id
      ),
    ]);

    const row = await env.DB.prepare('SELECT * FROM maintenance_requests WHERE id = ?').bind(id).first();
    return jsonOk({ success: true, data: serializeMaintenance(row as Record<string, unknown>) });
  } catch {
    return serverError();
  }
};
