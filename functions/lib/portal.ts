/** How many days a realtor keeps access after the anchor date. */
const WINDOW_DAYS = 30;

/**
 * Add days to a YYYY-MM-DD date and return YYYY-MM-DD.
 *
 * Date.UTC keeps this off the local clock entirely: we are doing calendar
 * arithmetic on a plain date, not on an instant, so UTC is the safe frame.
 * Parsing with new Date('2026-03-01') would be UTC midnight read back through
 * a local getter, which is the bug that filed expenses a month early.
 */
function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d) + days * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

/**
 * The last day a realtor may see a tenant.
 *
 * Thirty days from move in, or thirty days from the link, whichever is later.
 * Belle links realtors after the fact, so anchoring only on move in would mean
 * linking someone who moved in months ago granted nothing.
 */
export function realtorAccessEndsOn(
  leaseStartDate: string | undefined,
  linkedOnDate: string
): string {
  const fromLink = addDays(linkedOnDate, WINDOW_DAYS);
  if (!leaseStartDate) return fromLink;
  const fromMoveIn = addDays(leaseStartDate, WINDOW_DAYS);
  return fromMoveIn > fromLink ? fromMoveIn : fromLink;
}

/** Whether the realtor's window is still open on a given day, inclusive. */
export function realtorWindowOpen(
  leaseStartDate: string | undefined,
  linkedOnDate: string,
  today: string
): boolean {
  return today <= realtorAccessEndsOn(leaseStartDate, linkedOnDate);
}

// ---------------------------------------------------------------------------
// Scope resolvers — the one place that decides which tenants a portal caller
// may reach. Every portal endpoint must derive its reachable set from here,
// from the session, never from a client supplied id. A client supplied id is
// only ever used to filter WITHIN this resolved set.
// ---------------------------------------------------------------------------

import type { Env, SessionUser } from './session';

/** Today as YYYY-MM-DD. */
export function serverToday(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * A lease's pause intervals, oldest first, in the shape serializeLease expects.
 * The portal fetches one lease at a time, so this attaches its pauses before
 * serialising. Without them the tenant's pages would show a paused month as
 * unpaid, disagreeing with the owner's own Rent Management for the same lease.
 */
export async function leasePauses(
  env: Env,
  leaseId: string
): Promise<{ pausedAt: string; resumedAt?: string }[]> {
  const { results } = await env.DB.prepare(
    'SELECT paused_at, resumed_at FROM lease_pauses WHERE lease_id = ? ORDER BY paused_at'
  )
    .bind(leaseId)
    .all<{ paused_at: string; resumed_at: string | null }>();
  return (results || []).map(p => ({
    pausedAt: p.paused_at,
    resumedAt: p.resumed_at ?? undefined,
  }));
}

/** The tenant record belonging to a login, or null. One user, one tenant. */
export async function tenantIdForUser(env: Env, userId: string): Promise<string | null> {
  const row = await env.DB.prepare('SELECT id FROM tenants WHERE user_id = ?')
    .bind(userId)
    .first<{ id: string }>();
  return row?.id ?? null;
}

/**
 * The tenants a realtor may currently see: linked to them, and still inside
 * the window. The window is anchored on the tenant's most recent lease start,
 * which is what "move in" means for that person.
 */
export async function realtorTenantIds(
  env: Env,
  userId: string,
  today: string
): Promise<string[]> {
  const { results } = await env.DB.prepare(
    `SELECT tr.tenant_id AS tenant_id,
            date(tr.created_at, 'unixepoch') AS linked_on,
            (SELECT l.start_date
               FROM leases l
               JOIN lease_tenants lt ON lt.lease_id = l.id
              WHERE lt.tenant_id = tr.tenant_id
              ORDER BY l.start_date DESC
              LIMIT 1) AS lease_start
       FROM tenant_realtors tr
      WHERE tr.realtor_user_id = ?`
  )
    .bind(userId)
    .all<{ tenant_id: string; linked_on: string; lease_start: string | null }>();

  return (results || [])
    .filter(r => realtorWindowOpen(r.lease_start ?? undefined, r.linked_on, today))
    .map(r => r.tenant_id);
}

/**
 * Every tenant id this caller may reach, whoever they are. A tenant reaches
 * exactly themselves. A realtor reaches their linked tenants inside the window.
 * Anyone else reaches nothing through the portal.
 *
 * Endpoints filter within this set. They never fetch by a client supplied id.
 */
export async function reachableTenantIds(
  env: Env,
  auth: SessionUser,
  today: string
): Promise<string[]> {
  if (auth.role === 'tenant') {
    const id = await tenantIdForUser(env, auth.id);
    return id ? [id] : [];
  }
  if (auth.role === 'realtor') {
    return realtorTenantIds(env, auth.id, today);
  }
  return [];
}
