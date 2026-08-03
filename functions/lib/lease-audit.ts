import type { Env } from './session';
import { sendEmail, leaseStatusEmail } from './email';

export interface LeaseAuditEntry {
  leaseId: string;
  action: string;
  changedBy?: string;
  changedByName?: string;
  previousData?: Record<string, unknown>;
  newData?: Record<string, unknown>;
  notes?: string;
}

export async function logLeaseChange(env: Env, entry: LeaseAuditEntry): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO lease_audit_log (id, lease_id, action, changed_by, changed_by_name, previous_data, new_data, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    crypto.randomUUID(),
    entry.leaseId,
    entry.action,
    entry.changedBy ?? null,
    entry.changedByName ?? null,
    entry.previousData ? JSON.stringify(entry.previousData) : null,
    entry.newData ? JSON.stringify(entry.newData) : null,
    entry.notes ?? null,
  ).run();
}

const STATUS_LABELS: Record<string, string> = {
  active: 'Active',
  paused: 'Paused',
  ended: 'Terminated',
};

export async function notifyLeaseStatusChange(
  env: Env,
  leaseId: string,
  newStatus: string,
  effectiveDate: string,
  reason?: string,
  sentBy?: string,
): Promise<void> {
  const lease = await env.DB.prepare(
    `SELECT l.id, l.property_id, l.unit_id,
            p.address AS prop_address, p.name AS prop_name,
            u.unit_number
     FROM leases l
     LEFT JOIN properties p ON p.id = l.property_id
     LEFT JOIN units u ON u.id = l.unit_id
     WHERE l.id = ?`
  ).bind(leaseId).first();
  if (!lease) return;

  const tenants = await env.DB.prepare(
    `SELECT t.id, t.first_name, t.last_name, t.email
     FROM tenants t JOIN lease_tenants lt ON lt.tenant_id = t.id
     WHERE lt.lease_id = ?`
  ).bind(leaseId).all<{ id: string; first_name: string; last_name: string; email: string | null }>();

  if (!tenants.results?.length) return;

  const address = (lease.prop_address || lease.prop_name || '') as string;
  const unitNumber = (lease.unit_number as string) || undefined;
  const statusLabel = STATUS_LABELS[newStatus] || newStatus;

  for (const tenant of tenants.results) {
    if (!tenant.email) continue;

    const emailData = leaseStatusEmail({
      name: tenant.first_name,
      propertyAddress: address,
      unitNumber,
      statusLabel,
      effectiveDate,
      reason,
    });

    const sent = await sendEmail(env, {
      to: tenant.email,
      subject: emailData.subject,
      html: emailData.html,
      text: emailData.text,
    });

    await env.DB.prepare(
      `INSERT INTO lease_notifications (id, lease_id, tenant_id, tenant_email, notification_type, subject, status, sent_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      crypto.randomUUID(),
      leaseId,
      tenant.id,
      tenant.email,
      newStatus,
      emailData.subject,
      sent ? 'sent' : 'failed',
      sentBy ?? null,
    ).run();
  }
}
