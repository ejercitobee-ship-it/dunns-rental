import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../lib/session';
import { serializeMaintenance } from '../../lib/serializers';
import { deleteDriveFile } from '../../lib/google';
import { maintenanceExpenseId, logStatusChange } from '../../lib/maintenance';

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'properties_view');
  if (auth instanceof Response) return auth;

  try {
    const row = await env.DB.prepare('SELECT * FROM maintenance_requests WHERE id = ?')
      .bind(params.id as string)
      .first();
    if (!row) return jsonError('Request not found', 404);
    return jsonOk({ success: true, data: serializeMaintenance(row as Record<string, unknown>) });
  } catch {
    return serverError();
  }
};

export const onRequestPut: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'properties_edit');
  if (auth instanceof Response) return auth;

  try {
    const id = params.id as string;
    const body = (await request.json()) as Record<string, unknown>;
    const newStatus = (body.status as string) ?? 'submitted';
    const cost = Number(body.cost) || 0;
    const propertyId = (body.propertyId as string) ?? null;
    const unitId = (body.unitId as string) ?? null;
    const title = body.title as string;

    // Check the old status so we know if it changed.
    const prev = await env.DB.prepare('SELECT status, assigned_handyman_id FROM maintenance_requests WHERE id = ?')
      .bind(id)
      .first<{ status: string; assigned_handyman_id: string | null }>();
    if (!prev) return jsonError('Request not found', 404);

    const stmts = [
      // Content edit: never touches workflow columns (assigned_handyman_id,
      // scheduled_for, paid_at, created_by).
      env.DB.prepare(
        `UPDATE maintenance_requests SET
          property_id = ?, unit_id = ?, tenant_id = ?, title = ?, description = ?, category = ?,
          priority = ?, status = ?, cost = ?, vendor = ?, reported_date = ?, resolved_date = ?, notes = ?,
          updated_at = unixepoch()
         WHERE id = ?`
      )
        .bind(
          propertyId,
          unitId,
          body.tenantId ?? null,
          title,
          body.description ?? null,
          body.category ?? null,
          body.priority ?? 'medium',
          newStatus,
          cost,
          body.vendor ?? null,
          body.reportedDate ?? null,
          body.resolvedDate ?? null,
          body.notes ?? null,
          id
        ),
    ];

    // When the status changes to 'paid' through the edit form, write an
    // expense so it immediately shows in the financial reports, using the
    // handyman's company name as the vendor (same logic as the pay endpoint).
    if (newStatus === 'paid' && prev.status !== 'paid' && cost > 0) {
      let vendor: string | null = (body.vendor as string) || null;
      if (!vendor && prev.assigned_handyman_id) {
        const h = await env.DB.prepare('SELECT COALESCE(company_name, name) AS name FROM handymen WHERE id = ?')
          .bind(prev.assigned_handyman_id)
          .first<{ name: string }>();
        vendor = h?.name ?? null;
      }
      const today = new Date().toISOString().slice(0, 10);
      const expenseId = maintenanceExpenseId(id);
      stmts.push(
        env.DB.prepare(
          `INSERT INTO expenses (id, property_id, unit_id, category, amount, date, description, vendor, is_recurring, user_id)
           VALUES (?, ?, ?, 'maintenance', ?, ?, ?, ?, 0, ?)
           ON CONFLICT(id) DO UPDATE SET
             amount = excluded.amount, date = excluded.date, description = excluded.description,
             vendor = excluded.vendor, property_id = excluded.property_id, unit_id = excluded.unit_id,
             updated_at = unixepoch()`
        ).bind(expenseId, propertyId, unitId, cost, today, `Maintenance: ${title}`, vendor, auth.id)
      );
    }

    // If the status moves AWAY from paid, remove the expense so it does not
    // double-count when the request later goes through the proper pay flow.
    if (newStatus !== 'paid' && prev.status === 'paid') {
      stmts.push(
        env.DB.prepare('DELETE FROM expenses WHERE id = ?').bind(maintenanceExpenseId(id))
      );
    }

    // Log the status transition so the Work Order Details history stays complete.
    if (newStatus !== prev.status) {
      stmts.push(logStatusChange(env.DB, id, prev.status, newStatus, auth.id, auth.name));
    }

    await env.DB.batch(stmts);

    const row = await env.DB.prepare('SELECT * FROM maintenance_requests WHERE id = ?').bind(id).first();
    if (!row) return jsonError('Request not found', 404);
    return jsonOk({ success: true, data: serializeMaintenance(row as Record<string, unknown>) });
  } catch {
    return serverError();
  }
};

export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'properties_delete');
  if (auth instanceof Response) return auth;

  try {
    const id = params.id as string;

    // Deleting a report removes everything tied to it, so nothing is left
    // behind in Finances or storage:
    //   1. the maintenance expense the "mark paid" step wrote (id = maint-<id>),
    //      which otherwise keeps counting against income on the Dashboard and
    //      the per-property breakdown;
    //   2. the tenant's attached photo in Google Drive (best-effort);
    //   3. the request row itself, which carries the whole history (status,
    //      assignment, schedule, availability) in its own columns.
    const row = await env.DB.prepare('SELECT photo_drive_id FROM maintenance_requests WHERE id = ?')
      .bind(id)
      .first<{ photo_drive_id: string | null }>();
    if (!row) return jsonOk({ success: true });

    if (row.photo_drive_id) {
      try { await deleteDriveFile(env, row.photo_drive_id); } catch { /* already gone or Drive down */ }
    }

    await env.DB.batch([
      env.DB.prepare('DELETE FROM expenses WHERE id = ?').bind(maintenanceExpenseId(id)),
      env.DB.prepare('DELETE FROM maintenance_requests WHERE id = ?').bind(id),
    ]);

    return jsonOk({ success: true });
  } catch {
    return serverError();
  }
};
