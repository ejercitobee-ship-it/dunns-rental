import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../../lib/session';
import { logLeaseChange, notifyLeaseStatusChange } from '../../../lib/lease-audit';
import { syncRentSheet } from '../../../lib/sheets';

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'tenants_edit');
  if (auth instanceof Response) return auth;

  try {
    const newLeaseId = params.id as string;
    const body = (await request.json()) as { action: 'approve' | 'reject' };
    const action = body.action;

    if (action !== 'approve' && action !== 'reject') {
      return jsonError('Action must be "approve" or "reject"', 400);
    }

    const newLease = await env.DB.prepare(
      `SELECT l.*, p.address AS prop_address, p.name AS prop_name, u.unit_number
       FROM leases l
       LEFT JOIN properties p ON p.id = l.property_id
       LEFT JOIN units u ON u.id = l.unit_id
       WHERE l.id = ? AND l.renewal_status = 'pending'`
    ).bind(newLeaseId).first();

    if (!newLease) {
      return jsonError('No pending renewal found for this lease', 404);
    }

    const previousLeaseId = newLease.renewed_from_lease_id as string;

    if (action === 'reject') {
      await env.DB.batch([
        env.DB.prepare("UPDATE leases SET renewal_status = 'rejected', status = 'ended', end_reason = 'Renewal Rejected', updated_at = unixepoch() WHERE id = ?")
          .bind(newLeaseId),
      ]);

      context.waitUntil(
        logLeaseChange(env, {
          leaseId: previousLeaseId,
          action: 'Renewal Rejected',
          changedBy: auth.id,
          changedByName: auth.name,
          newData: { rejectedRenewalId: newLeaseId },
        }).catch(() => {})
      );

      return jsonOk({ success: true, status: 'rejected' });
    }

    const now = new Date().toISOString().slice(0, 10);

    await env.DB.batch([
      env.DB.prepare("UPDATE leases SET renewal_status = 'approved', updated_at = unixepoch() WHERE id = ?")
        .bind(newLeaseId),
      env.DB.prepare("UPDATE leases SET status = 'ended', end_reason = 'Renewed', updated_at = unixepoch() WHERE id = ?")
        .bind(previousLeaseId),
      env.DB.prepare('UPDATE units SET monthly_rent = ?, updated_at = unixepoch() WHERE id = ?')
        .bind(Number(newLease.monthly_rent), newLease.unit_id),
    ]);

    context.waitUntil(
      logLeaseChange(env, {
        leaseId: previousLeaseId,
        action: 'Renewal Approved',
        changedBy: auth.id,
        changedByName: auth.name,
        previousData: { monthlyRent: newLease.previous_rent, leaseId: previousLeaseId },
        newData: { monthlyRent: newLease.monthly_rent, newLeaseId, startDate: newLease.start_date, endDate: newLease.end_date },
      }).catch(() => {})
    );

    context.waitUntil(
      notifyLeaseStatusChange(env, newLeaseId, 'renewed', now, undefined, auth.id)
        .catch(e => console.error('renewal approval notification failed', e))
    );

    syncRentSheet(context);
    return jsonOk({ success: true, status: 'approved', newLeaseId });
  } catch {
    return serverError();
  }
};
