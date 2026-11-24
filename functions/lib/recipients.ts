import type { Env } from './session';
import { getSetting } from './google';
import { computeRentStatus } from './ai-tools';

// The recipient segmentation engine for email campaigns.
//
// Given a filter, it resolves the deduped set of tenant recipients server-side
// (never trusting a client-supplied list), reusing the app's own lease/tenant
// data. A tenant that qualifies under several conditions appears once.
//
// Base segments (all active, by property, lease expiring 30/60/90 days,
// month-to-month) plus explicit include/exclude and manual addresses resolve in
// SQL. The financial and maintenance segments narrow that base using the app's
// own rent-status engine (computeRentStatus) and live maintenance records, so
// rent math is never re-derived here.

export interface RecipientFilter {
  scope?: 'all_active' | 'by_property';
  propertyIds?: string[];
  lease?: 'any' | 'expiring_30' | 'expiring_60' | 'expiring_90' | 'month_to_month';
  // Narrowing conditions applied on top of the base segment (AND).
  financial?: 'any' | 'has_balance' | 'overdue';
  maintenance?: 'any' | 'open_request';
  includeTenantIds?: string[];
  excludeTenantIds?: string[];
  manualEmails?: string[];
}

const OPEN_MAINTENANCE_STATUSES = ['submitted', 'available', 'assigned', 'scheduled', 'in_progress'];

/** Tenant ids with an open (not completed / paid / cancelled) maintenance request. */
async function openMaintenanceTenantIds(env: Env): Promise<Set<string>> {
  const ph = OPEN_MAINTENANCE_STATUSES.map(() => '?').join(',');
  const { results } = await env.DB.prepare(
    `SELECT DISTINCT tenant_id FROM maintenance_requests
      WHERE tenant_id IS NOT NULL AND status IN (${ph})`
  ).bind(...OPEN_MAINTENANCE_STATUSES).all<{ tenant_id: string }>();
  return new Set((results || []).map((r) => r.tenant_id));
}

/** Today's day-of-month in the property timezone (America/Chicago). */
function chicagoDayOfMonth(): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', day: '2-digit' }).formatToParts(new Date());
  return Number(parts.find((p) => p.type === 'day')?.value ?? '1');
}

/** The configured global rent due day (1-31, default 1). */
async function rentDueDay(env: Env): Promise<number> {
  const raw = await getSetting(env, 'rent');
  if (raw) {
    try {
      const r = JSON.parse(raw) as { rentDueDay?: unknown };
      if (typeof r.rentDueDay === 'number' && r.rentDueDay >= 1 && r.rentDueDay <= 31) return Math.floor(r.rentDueDay);
    } catch { /* fall through to default */ }
  }
  return 1;
}

/**
 * Tenant ids who owe rent for the current month, taken straight from the app's
 * rent engine (computeRentStatus) so the targeting matches what Rent Management
 * shows. 'has_balance' = any outstanding balance this month; 'overdue' = the
 * same, but only once the monthly due day has passed.
 */
async function financialTenantIds(env: Env, mode: 'has_balance' | 'overdue'): Promise<Set<string>> {
  const ids = new Set<string>();
  if (mode === 'overdue') {
    const due = await rentDueDay(env);
    if (chicagoDayOfMonth() <= due) return ids; // this month's rent is not late yet
  }
  const now = new Date();
  const computed = await computeRentStatus(env.DB, now.getMonth() + 1, now.getFullYear());
  const owingLeaseIds = computed.rows.filter((r) => r.amountOwed > 0.005).map((r) => r.leaseId);
  if (owingLeaseIds.length === 0) return ids;
  const ph = owingLeaseIds.map(() => '?').join(',');
  const { results } = await env.DB.prepare(
    `SELECT DISTINCT tenant_id FROM lease_tenants WHERE lease_id IN (${ph})`
  ).bind(...owingLeaseIds).all<{ tenant_id: string }>();
  for (const r of results || []) ids.add(r.tenant_id);
  return ids;
}

export interface ResolvedRecipient {
  tenantId?: string;
  name: string;
  email: string;
}

function leaseConditionSql(lease?: RecipientFilter['lease']): string {
  switch (lease) {
    case 'expiring_30':
      return "AND l.lease_type = 'fixed' AND l.end_date IS NOT NULL AND l.end_date >= date('now') AND l.end_date <= date('now', '+30 days')";
    case 'expiring_60':
      return "AND l.lease_type = 'fixed' AND l.end_date IS NOT NULL AND l.end_date >= date('now') AND l.end_date <= date('now', '+60 days')";
    case 'expiring_90':
      return "AND l.lease_type = 'fixed' AND l.end_date IS NOT NULL AND l.end_date >= date('now') AND l.end_date <= date('now', '+90 days')";
    case 'month_to_month':
      return "AND l.lease_type = 'month_to_month'";
    default:
      return '';
  }
}

export async function resolveRecipients(env: Env, filter: RecipientFilter): Promise<ResolvedRecipient[]> {
  const byEmail = new Map<string, ResolvedRecipient>();
  const addTenantRow = (r: { tenant_id: string; first_name: string | null; last_name: string | null; email: string | null }) => {
    const email = (r.email || '').trim();
    if (!email) return;
    const key = email.toLowerCase();
    if (!byEmail.has(key)) {
      byEmail.set(key, { tenantId: r.tenant_id, name: `${r.first_name ?? ''} ${r.last_name ?? ''}`.trim() || email, email });
    }
  };

  const leaseCond = leaseConditionSql(filter.lease);
  const byProperty = filter.scope === 'by_property' && filter.propertyIds && filter.propertyIds.length > 0;
  const propPlaceholders = byProperty ? filter.propertyIds!.map(() => '?').join(',') : '';

  // Base segment: active tenants (optionally scoped by property / lease).
  const baseSql =
    `SELECT t.id AS tenant_id, t.first_name, t.last_name, t.email
       FROM tenants t
      WHERE t.email IS NOT NULL AND trim(t.email) != ''
        AND EXISTS (
          SELECT 1 FROM lease_tenants lt
            JOIN leases l ON l.id = lt.lease_id
           WHERE lt.tenant_id = t.id AND l.status = 'active'
             ${byProperty ? `AND l.property_id IN (${propPlaceholders})` : ''}
             ${leaseCond}
        )`;
  const baseStmt = byProperty
    ? env.DB.prepare(baseSql).bind(...filter.propertyIds!)
    : env.DB.prepare(baseSql);
  const { results: base } = await baseStmt.all<{ tenant_id: string; first_name: string | null; last_name: string | null; email: string | null }>();
  for (const r of base || []) addTenantRow(r);

  // Narrow the base segment by the financial / maintenance conditions (AND).
  // These reuse the app's rent engine and live maintenance data, never a
  // re-derivation of rent math. Applied before explicit includes so a manually
  // added tenant is never filtered out.
  const requiredSets: Set<string>[] = [];
  if (filter.financial === 'has_balance' || filter.financial === 'overdue') {
    requiredSets.push(await financialTenantIds(env, filter.financial));
  }
  if (filter.maintenance === 'open_request') {
    requiredSets.push(await openMaintenanceTenantIds(env));
  }
  if (requiredSets.length > 0) {
    for (const [key, rec] of [...byEmail.entries()]) {
      const ok = rec.tenantId && requiredSets.every((s) => s.has(rec.tenantId!));
      if (!ok) byEmail.delete(key);
    }
  }

  // Explicitly included tenants (added on top of the segment, active only).
  const include = (filter.includeTenantIds || []).filter(Boolean);
  if (include.length > 0) {
    const ph = include.map(() => '?').join(',');
    const { results } = await env.DB.prepare(
      `SELECT id AS tenant_id, first_name, last_name, email FROM tenants
        WHERE id IN (${ph}) AND email IS NOT NULL AND trim(email) != ''`
    ).bind(...include).all<{ tenant_id: string; first_name: string | null; last_name: string | null; email: string | null }>();
    for (const r of results || []) addTenantRow(r);
  }

  // Excluded tenants (removed whatever brought them in).
  const exclude = new Set((filter.excludeTenantIds || []).filter(Boolean));
  if (exclude.size > 0) {
    for (const [key, rec] of [...byEmail.entries()]) {
      if (rec.tenantId && exclude.has(rec.tenantId)) byEmail.delete(key);
    }
  }

  // Manually entered addresses (authorized ad-hoc recipients).
  for (const raw of filter.manualEmails || []) {
    const email = (raw || '').trim();
    if (!email || !email.includes('@')) continue;
    const key = email.toLowerCase();
    if (!byEmail.has(key)) byEmail.set(key, { name: email, email });
  }

  return [...byEmail.values()];
}
