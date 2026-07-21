import { type Env } from './session';
import { serializeMaintenance } from './serializers';
import { type RequestNotice, type AvailabilityWindow } from './maintenance-notify';

/** A maintenance row joined with its tenant, unit, and property, as the handyman
 * portal reads it. Extra columns are aliased so one serializer handles them. */
export interface JobRow extends Record<string, unknown> {
  first_name?: string | null;
  last_name?: string | null;
  tenant_phone?: string | null;
  tenant_email?: string | null;
  prop_address?: string | null;
  prop_name?: string | null;
  unit_number?: string | null;
}

/** The SELECT column list that feeds serializeJob and buildNotice. */
export const JOB_COLUMNS = `m.*,
  t.first_name AS first_name, t.last_name AS last_name, t.phone AS tenant_phone, t.email AS tenant_email,
  p.address AS prop_address, p.name AS prop_name, u.unit_number AS unit_number`;

export const JOB_JOINS = `FROM maintenance_requests m
  LEFT JOIN tenants t ON t.id = m.tenant_id
  LEFT JOIN properties p ON p.id = m.property_id
  LEFT JOIN units u ON u.id = m.unit_id`;

function locationLabel(row: JobRow): string {
  return [row.prop_address || row.prop_name, row.unit_number ? `Unit ${row.unit_number}` : null]
    .filter(Boolean)
    .join(', ');
}

function tenantName(row: JobRow): string {
  return `${row.first_name ?? ''} ${row.last_name ?? ''}`.trim();
}

/** The shape the handyman portal renders: the request plus tenant and location. */
export function serializeJob(row: JobRow) {
  return {
    ...serializeMaintenance(row),
    tenantName: tenantName(row) || undefined,
    tenantPhone: row.tenant_phone ?? undefined,
    locationLabel: locationLabel(row) || undefined,
  };
}

/** The notice payload the email helpers need, built from a joined job row. */
export function buildNotice(row: JobRow): RequestNotice {
  return {
    id: row.id as string,
    title: row.title as string,
    category: (row.category as string) ?? null,
    description: (row.description as string) ?? null,
    tenantName: tenantName(row) || null,
    locationLabel: locationLabel(row) || null,
    availability: (serializeMaintenance(row).availability as AvailabilityWindow[]) || [],
    scheduledFor: (row.scheduled_for as string) ?? null,
  };
}

/** The tenant's email for a job row, for notifications. */
export function tenantEmail(row: JobRow): string | null {
  return (row.tenant_email as string) || null;
}

/**
 * Load one job that belongs to this handyman, joined for serialization and
 * notices. Returns null when the job does not exist or is not theirs, so an
 * action can never touch another handyman's job.
 */
export async function loadOwnedJob(env: Env, jobId: string, handymanId: string): Promise<JobRow | null> {
  const row = await env.DB.prepare(
    `SELECT ${JOB_COLUMNS} ${JOB_JOINS} WHERE m.id = ? AND m.assigned_handyman_id = ?`
  )
    .bind(jobId, handymanId)
    .first<JobRow>();
  return row ?? null;
}
