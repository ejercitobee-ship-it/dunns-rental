import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../lib/session';
import { withLeaseDetails, findMissingTenantIds, readLeaseStatus, isValidDateString } from './index';

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
    const current = await env.DB.prepare('SELECT status FROM leases WHERE id = ?')
      .bind(id)
      .first<{ status: string }>();
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
          security_deposit = ?, status = ?, needs_review = 0, notes = ?, updated_at = unixepoch()
         WHERE id = ?`
      ).bind(
        body.unitId ?? null,
        body.propertyId ?? null,
        body.startDate ?? null,
        body.endDate ?? null,
        body.monthlyRent ?? 0,
        body.securityDeposit ?? 0,
        status,
        body.notes ?? null,
        id
      ),
    ];

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

    await env.DB.batch(statements);

    const row = await env.DB.prepare('SELECT * FROM leases WHERE id = ?').bind(id).first();
    if (!row) return jsonError('Lease not found', 404);
    const [data] = await withLeaseDetails(env, [row as Record<string, unknown>]);
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
    await env.DB.prepare('DELETE FROM leases WHERE id = ?').bind(params.id as string).run();
    return jsonOk({ success: true });
  } catch {
    return serverError();
  }
};
