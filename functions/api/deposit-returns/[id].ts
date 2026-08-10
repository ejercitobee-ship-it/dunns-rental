import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../lib/session';
import { serializeDepositReturn, serializeDepositDeduction } from '../../lib/serializers';

/** Get a single deposit return with its deductions. */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'finances_view');
  if (auth instanceof Response) return auth;

  try {
    const id = params.id as string;
    const row = await env.DB.prepare(
      'SELECT dr.*, t.first_name || \' \' || t.last_name AS tenant_name, p.name AS property_name, u.unit_number FROM deposit_returns dr LEFT JOIN tenants t ON dr.tenant_id = t.id LEFT JOIN properties p ON dr.property_id = p.id LEFT JOIN units u ON dr.unit_id = u.id WHERE dr.id = ?'
    ).bind(id).first();
    if (!row) return jsonError('Deposit return not found', 404);

    const { results: deductionRows } = await env.DB.prepare(
      'SELECT * FROM deposit_deductions WHERE deposit_return_id = ? ORDER BY created_at ASC'
    ).bind(id).all();

    return jsonOk({
      success: true,
      data: {
        ...serializeDepositReturn(row as Record<string, unknown>),
        tenantName: row.tenant_name ?? undefined,
        propertyName: row.property_name ?? undefined,
        unitNumber: row.unit_number ?? undefined,
        deductions: (deductionRows || []).map((d) => serializeDepositDeduction(d as Record<string, unknown>)),
      },
    });
  } catch {
    return serverError();
  }
};

/** Update a deposit return (status, refund info, notes, deductions). */
export const onRequestPut: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'finances_income');
  if (auth instanceof Response) return auth;

  try {
    const id = params.id as string;
    const body = (await request.json()) as Record<string, unknown>;

    // If deductions are provided, replace them all (simple approach)
    const deductions = body.deductions as Array<{ category: string; description: string; amount: number }> | undefined;
    let totalDeductions = 0;

    if (deductions && Array.isArray(deductions)) {
      // Delete existing deductions
      await env.DB.prepare('DELETE FROM deposit_deductions WHERE deposit_return_id = ?').bind(id).run();

      // Insert new deductions
      for (const d of deductions) {
        const amount = Number(d.amount);
        if (!Number.isFinite(amount) || amount < 0) continue;
        totalDeductions += amount;
        await env.DB.prepare(
          'INSERT INTO deposit_deductions (id, deposit_return_id, category, description, amount) VALUES (?, ?, ?, ?, ?)'
        )
          .bind(crypto.randomUUID(), id, d.category, d.description, amount)
          .run();
      }
    }

    const depositAmount = body.depositAmount !== undefined ? Number(body.depositAmount) : undefined;

    // Build update SQL
    const sets: string[] = ['updated_at = unixepoch()'];
    const binds: unknown[] = [];

    if (body.status !== undefined) { sets.push('status = ?'); binds.push(body.status); }
    if (body.moveOutDate !== undefined) { sets.push('move_out_date = ?'); binds.push(body.moveOutDate); }
    if (body.deadlineDate !== undefined) { sets.push('deadline_date = ?'); binds.push(body.deadlineDate); }
    if (body.refundDate !== undefined) { sets.push('refund_date = ?'); binds.push(body.refundDate || null); }
    if (body.refundMethod !== undefined) { sets.push('refund_method = ?'); binds.push(body.refundMethod || null); }
    if (body.notes !== undefined) { sets.push('notes = ?'); binds.push(body.notes || null); }

    if (deductions && Array.isArray(deductions)) {
      sets.push('total_deductions = ?');
      binds.push(totalDeductions);
      // Recalculate refund from current deposit_amount and new deductions
      const currentRow = await env.DB.prepare('SELECT deposit_amount FROM deposit_returns WHERE id = ?').bind(id).first();
      const currentDeposit = depositAmount ?? (currentRow ? Number(currentRow.deposit_amount) : 0);
      sets.push('refund_amount = ?');
      binds.push(Math.max(0, currentDeposit - totalDeductions));
    }

    if (depositAmount !== undefined) {
      sets.push('deposit_amount = ?');
      binds.push(depositAmount);
    }

    binds.push(id);
    await env.DB.prepare(`UPDATE deposit_returns SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();

    // Return updated record
    const row = await env.DB.prepare(
      'SELECT dr.*, t.first_name || \' \' || t.last_name AS tenant_name, p.name AS property_name, u.unit_number FROM deposit_returns dr LEFT JOIN tenants t ON dr.tenant_id = t.id LEFT JOIN properties p ON dr.property_id = p.id LEFT JOIN units u ON dr.unit_id = u.id WHERE dr.id = ?'
    ).bind(id).first();
    if (!row) return jsonError('Deposit return not found', 404);

    const { results: deductionRows } = await env.DB.prepare(
      'SELECT * FROM deposit_deductions WHERE deposit_return_id = ? ORDER BY created_at ASC'
    ).bind(id).all();

    return jsonOk({
      success: true,
      data: {
        ...serializeDepositReturn(row as Record<string, unknown>),
        tenantName: row.tenant_name ?? undefined,
        propertyName: row.property_name ?? undefined,
        unitNumber: row.unit_number ?? undefined,
        deductions: (deductionRows || []).map((d) => serializeDepositDeduction(d as Record<string, unknown>)),
      },
    });
  } catch {
    return serverError();
  }
};

/** Delete a deposit return and its deductions (cascade). */
export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'finances_income');
  if (auth instanceof Response) return auth;

  try {
    const id = params.id as string;
    // Deductions are cascade-deleted by the FK constraint
    await env.DB.prepare('DELETE FROM deposit_returns WHERE id = ?').bind(id).run();
    return jsonOk({ success: true });
  } catch {
    return serverError();
  }
};
