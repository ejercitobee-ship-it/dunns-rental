import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../lib/session';
import { withLeaseDetails, findMissingTenantIds, readLeaseStatus, isValidDateString, leaseEndDate } from './index';
import { syncRentSheet } from '../../lib/sheets';
import { logLeaseChange, notifyLeaseStatusChange } from '../../lib/lease-audit';
import { logActivityStmt } from '../../lib/activity';

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'tenants_view');
  if (auth instanceof Response) return auth;

  try {
    const row = await env.DB.prepare('SELECT * FROM leases WHERE id = ?')
      .bind(params.id as string)
      .first();
    if (!row) return jsonError('Lease not found', 404);
    const [data] = await withLeaseDetails(env, [row as Record<string, unknown>]);
    return jsonOk({ success: true, data });
  } catch {
    return serverError();
  }
};

export const onRequestPut: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'tenants_edit');
  if (auth instanceof Response) return auth;

  try {
    const id = params.id as string;
    const body = (await request.json()) as Record<string, unknown>;

    const status = readLeaseStatus(body.status);
    if (status === null) {
      return jsonError('Status must be one of: active, paused, ended', 400);
    }

    // The CURRENT status decides whether this PUT is a pause/resume
    // transition. Read before any write: the pause interval has to be
    // stamped in the SAME batch as the lease UPDATE below, so the batch needs
    // to know up front whether it is opening or closing one.
    const current = await env.DB.prepare(
      `SELECT status, monthly_rent, start_date, end_date, unit_id, property_id, rent_due_day, notes,
              security_deposit, move_in_fee_paid, move_in_fee_paid_date
         FROM leases WHERE id = ?`
    ).bind(id).first<{
      status: string; monthly_rent: number; start_date: string; end_date: string;
      unit_id: string; property_id: string; rent_due_day: number | null; notes: string | null;
      security_deposit: number | null; move_in_fee_paid: number; move_in_fee_paid_date: string | null;
    }>();
    if (!current) return jsonError('Lease not found', 404);

    // The day the status actually changed, in the OWNER's local day (America/
    // Chicago), not the server's. The server has no timezone of its own, so
    // the client sends this (built with todayLocalDate()); a missing value
    // falls back to the server's UTC date, which only happens for an older
    // client or a direct API call, never the app's own status-change flow.
    let statusChangedOn: string;
    if (body.statusChangedOn === undefined || body.statusChangedOn === null || body.statusChangedOn === '') {
      statusChangedOn = new Date().toISOString().slice(0, 10);
    } else if (isValidDateString(body.statusChangedOn)) {
      statusChangedOn = body.statusChangedOn;
    } else {
      return jsonError('statusChangedOn must be YYYY-MM-DD', 400);
    }

    const tenantIds = Array.isArray(body.tenantIds) ? (body.tenantIds as string[]) : null;
    if (tenantIds && tenantIds.length) {
      const missing = await findMissingTenantIds(env, tenantIds);
      if (missing.length) return jsonError('One or more tenants could not be found', 400);
    }

    const statements = [
      env.DB.prepare(
        `UPDATE leases SET
          unit_id = ?, property_id = ?, start_date = ?, end_date = ?, monthly_rent = ?,
          security_deposit = ?, move_in_fee_paid = ?, status = ?, needs_review = 0, notes = ?,
          end_reason = ?, ended_property_label = ?, ended_unit_label = ?, rent_due_day = ?,
          deposit_amount = ?, deposit_paid = ?, deposit_paid_date = ?, deposit_method = ?,
          updated_at = unixepoch()
         WHERE id = ?`
      ).bind(
        body.unitId ?? null,
        body.propertyId ?? null,
        body.startDate ?? null,
        leaseEndDate(body.startDate, body.endDate),
        body.monthlyRent ?? 0,
        body.securityDeposit ?? 0,
        body.moveInFeePaid === false ? 0 : 1,
        status,
        body.notes ?? null,
        body.endReason ?? null,
        body.endedPropertyLabel ?? null,
        body.endedUnitLabel ?? null,
        typeof body.rentDueDay === 'number' && body.rentDueDay >= 1 && body.rentDueDay <= 31
          ? Math.floor(body.rentDueDay) : null,
        Number(body.depositAmount) || 0,
        body.depositPaid ? 1 : 0,
        body.depositPaidDate ?? null,
        body.depositMethod ?? null,
        id
      ),
    ];

    // Make the lease's rent effective on the unit itself, so an approved
    // (possibly realtor-raised) rent becomes the unit's current rent going
    // forward, not just this lease's figure. Only when there is a unit and a
    // real amount.
    const leaseRent = Number(body.monthlyRent);
    if (body.unitId && Number.isFinite(leaseRent) && leaseRent > 0) {
      statements.push(
        env.DB.prepare('UPDATE units SET monthly_rent = ?, updated_at = unixepoch() WHERE id = ?')
          .bind(leaseRent, body.unitId)
      );
    }

    // Replace the occupant list when the caller sends one.
    if (tenantIds) {
      statements.push(env.DB.prepare('DELETE FROM lease_tenants WHERE lease_id = ?').bind(id));
      for (const tid of tenantIds) {
        statements.push(
          env.DB.prepare(
            'INSERT OR IGNORE INTO lease_tenants (id, lease_id, tenant_id) VALUES (?, ?, ?)'
          ).bind(crypto.randomUUID(), id, tid)
        );
      }
    }

    // The server owns the pause stamping, not the client, so the UI cannot
    // forget to record one or disagree with the database. Both directions
    // happen in the SAME batch as the lease UPDATE above, so they commit or
    // fail together with it.
    if (current.status !== 'paused' && status === 'paused') {
      // Starting a new pause. A second pause on a lease that has resumed
      // before opens a SECOND interval rather than overwriting the first, so
      // the earlier gap stays unbilled too.
      statements.push(
        env.DB.prepare(
          'INSERT INTO lease_pauses (id, lease_id, paused_at, resumed_at) VALUES (?, ?, ?, NULL)'
        ).bind(crypto.randomUUID(), id, statusChangedOn)
      );
    } else if (current.status === 'paused' && status !== 'paused') {
      // Leaving paused, whether to active (resume) or ended. Closes whatever
      // interval is still open; there is only ever one at a time, since a
      // lease already paused cannot open a second one via this same branch.
      statements.push(
        env.DB.prepare(
          'UPDATE lease_pauses SET resumed_at = ? WHERE lease_id = ? AND resumed_at IS NULL'
        ).bind(statusChangedOn, id)
      );
    }

    // Sync move-in fee to the incomes table so it shows on the Finances page
    // and Tax Report. The dedicated move-in-fee endpoint already does this,
    // but the general lease edit also changes the amount, so keep them in sync.
    const newDeposit = Number(body.securityDeposit) || 0;
    const newPaid = body.moveInFeePaid !== false;
    const incomeId = `movein-${id}`;
    if (newPaid && newDeposit > 0) {
      // Use the existing paid date, or fall back to the lease start date, or today.
      const incomeDate = current.move_in_fee_paid_date || (body.startDate as string) || new Date().toISOString().slice(0, 10);
      statements.push(
        env.DB.prepare(
          `INSERT INTO incomes (id, property_id, unit_id, source, amount, date, description, user_id)
           VALUES (?, ?, ?, 'move_in_fee', ?, ?, 'Move-in fee', ?)
           ON CONFLICT(id) DO UPDATE SET
             amount = excluded.amount, date = excluded.date,
             property_id = excluded.property_id, unit_id = excluded.unit_id`
        ).bind(incomeId, body.propertyId ?? null, body.unitId ?? null, newDeposit, incomeDate, auth.id)
      );
    } else if (!newPaid || newDeposit <= 0) {
      // Fee was removed or marked unpaid: delete the income record if it exists.
      statements.push(
        env.DB.prepare('DELETE FROM incomes WHERE id = ?').bind(incomeId)
      );
    }

    statements.push(
      logActivityStmt(env.DB, auth, {
        module: 'leases',
        action: current.status !== status
          ? (status === 'paused' ? 'Paused a lease' : status === 'ended' ? 'Terminated a lease' : 'Resumed a lease')
          : 'Updated a lease',
        targetType: 'leases',
        targetId: id,
        propertyId: (body.propertyId as string) || undefined,
        unitId: (body.unitId as string) || undefined,
        previousValues: { status: current.status, monthlyRent: current.monthly_rent, startDate: current.start_date, endDate: current.end_date },
        newValues: { status, monthlyRent: body.monthlyRent, startDate: body.startDate, endDate: body.endDate },
      })
    );

    await env.DB.batch(statements);

    const statusChanged = current.status !== status;
    const rentChanged = Number(current.monthly_rent) !== Number(body.monthlyRent);
    const datesChanged = current.start_date !== (body.startDate ?? null) || current.end_date !== leaseEndDate(body.startDate, body.endDate);

    let auditAction = 'Updated';
    if (statusChanged) {
      if (status === 'paused') auditAction = 'Paused';
      else if (status === 'ended') auditAction = 'Terminated';
      else if (current.status === 'paused' && status === 'active') auditAction = 'Resumed';
    } else if (rentChanged) {
      auditAction = 'Rent Changed';
    } else if (datesChanged) {
      auditAction = 'Dates Updated';
    }

    context.waitUntil(
      logLeaseChange(env, {
        leaseId: id,
        action: auditAction,
        changedBy: auth.id,
        changedByName: auth.name,
        previousData: {
          status: current.status,
          monthlyRent: current.monthly_rent,
          startDate: current.start_date,
          endDate: current.end_date,
          rentDueDay: current.rent_due_day,
        },
        newData: {
          status,
          monthlyRent: body.monthlyRent,
          startDate: body.startDate,
          endDate: body.endDate,
          rentDueDay: body.rentDueDay,
        },
        notes: statusChanged && status === 'ended' ? (body.endReason as string) || undefined : undefined,
      }).catch(() => {})
    );

    if (statusChanged) {
      context.waitUntil(
        notifyLeaseStatusChange(env, id, status, statusChangedOn, (body.endReason as string) || undefined, auth.id)
          .catch(e => console.error('lease notification failed', e))
      );
    }

    const row = await env.DB.prepare('SELECT * FROM leases WHERE id = ?').bind(id).first();
    if (!row) return jsonError('Lease not found', 404);
    const [data] = await withLeaseDetails(env, [row as Record<string, unknown>]);
    syncRentSheet(context);
    return jsonOk({ success: true, data });
  } catch {
    return serverError();
  }
};

export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'tenants_delete');
  if (auth instanceof Response) return auth;

  try {
    const id = params.id as string;
    const leaseInfo = await env.DB.prepare('SELECT property_id, unit_id, monthly_rent FROM leases WHERE id = ?')
      .bind(id).first<{ property_id: string | null; unit_id: string | null; monthly_rent: number }>();
    // D1 does not enforce foreign keys by default, so cascade manually.
    // Core tables first, then the lease itself.
    await env.DB.batch([
      env.DB.prepare('DELETE FROM rent_payments WHERE lease_id = ?').bind(id),
      env.DB.prepare('DELETE FROM lease_tenants WHERE lease_id = ?').bind(id),
      env.DB.prepare('DELETE FROM lease_pauses WHERE lease_id = ?').bind(id),
      env.DB.prepare('DELETE FROM household_members WHERE lease_id = ?').bind(id),
      env.DB.prepare('DELETE FROM leases WHERE id = ?').bind(id),
      logActivityStmt(env.DB, auth, {
        module: 'leases',
        action: 'Deleted a lease',
        targetType: 'leases',
        targetId: id,
        propertyId: leaseInfo?.property_id || undefined,
        unitId: leaseInfo?.unit_id || undefined,
        description: leaseInfo ? `$${leaseInfo.monthly_rent}/mo` : undefined,
      }),
    ]);
    // Newer tables that may not exist in all environments.
    try { await env.DB.prepare('DELETE FROM lease_audit_log WHERE lease_id = ?').bind(id).run(); } catch { /* table may not exist */ }
    try { await env.DB.prepare('DELETE FROM lease_notifications WHERE lease_id = ?').bind(id).run(); } catch { /* table may not exist */ }
    syncRentSheet(context);
    return jsonOk({ success: true });
  } catch {
    return serverError();
  }
};
