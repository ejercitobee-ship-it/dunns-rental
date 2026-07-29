import { type Env } from './session';

type Row = Record<string, unknown>;

export const PROSPECTIVE_STATUSES = ['applied', 'docs_sent', 'signed', 'converted', 'rejected'] as const;
export type ProspectiveStatus = (typeof PROSPECTIVE_STATUSES)[number];

/** D1 row -> camelCase applicant shape. */
export function serializeProspective(r: Row) {
  return {
    id: r.id,
    firstName: r.first_name,
    lastName: r.last_name,
    email: r.email ?? undefined,
    phone: r.phone ?? undefined,
    notes: r.notes ?? undefined,
    status: r.status ?? 'applied',
    convertedTenantId: r.converted_tenant_id ?? undefined,
    createdAt: r.created_at,
  };
}

export interface ProspectiveInput {
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  notes: string | null;
}
export type Validation = { ok: true; value: ProspectiveInput } | { ok: false; error: string };

const MAX = 200;

/** Validate and normalise applicant contact fields. Only a name is required. */
export function validateProspective(body: {
  firstName?: unknown; lastName?: unknown; email?: unknown; phone?: unknown; notes?: unknown;
}): Validation {
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const firstName = str(body.firstName);
  const lastName = str(body.lastName);
  if (!firstName || !lastName) return { ok: false, error: 'First and last name are required' };
  const email = str(body.email);
  const phone = str(body.phone);
  const notes = str(body.notes);
  for (const v of [firstName, lastName, email, phone]) {
    if (v.length > MAX) return { ok: false, error: 'A field is too long' };
  }
  return { ok: true, value: { firstName, lastName, email: email || null, phone: phone || null, notes: notes || null } };
}

export function isProspectiveStatus(v: unknown): v is ProspectiveStatus {
  return typeof v === 'string' && (PROSPECTIVE_STATUSES as readonly string[]).includes(v);
}

/** Load one applicant row, or null. */
export async function getProspective(env: Env, id: string): Promise<Row | null> {
  return env.DB.prepare('SELECT * FROM prospective_tenants WHERE id = ?').bind(id).first();
}
