import type { Env } from './session';

// The recipient segmentation engine for email campaigns.
//
// Given a filter, it resolves the deduped set of tenant recipients server-side
// (never trusting a client-supplied list), reusing the app's own lease/tenant
// data. A tenant that qualifies under several conditions appears once.
//
// PHASE 2 covers the cleanly-queryable segments: all active, by property, lease
// expiring (30/60/90 days), month-to-month, plus explicit include/exclude and
// manually entered addresses. Financial ("has balance" / "overdue") and
// maintenance segments are deferred to Phase 2.1 so they can reuse the real
// rent-status logic rather than re-deriving rent math here.

export interface RecipientFilter {
  scope?: 'all_active' | 'by_property';
  propertyIds?: string[];
  lease?: 'any' | 'expiring_30' | 'expiring_60' | 'expiring_90' | 'month_to_month';
  includeTenantIds?: string[];
  excludeTenantIds?: string[];
  manualEmails?: string[];
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
