// Server-side maintenance constants and small helpers. Kept separate from the
// React app's src/lib/maintenance.ts because the functions build has its own
// tsconfig and cannot import from src.

import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';

export const MAINTENANCE_TRADES = [
  'plumbing',
  'electrical',
  'hvac',
  'appliance',
  'carpentry',
  'general',
  'other',
] as const;

export const MAINTENANCE_STATUSES = [
  'submitted',
  'assigned',
  'scheduled',
  'in_progress',
  'completed',
  // Invoice workflow statuses (after admin approves completed work).
  'approved_for_invoicing',
  'invoice_submitted',
  'invoice_approved',
  'paid',
  'cancelled',
] as const;

export type MaintenanceStatus = (typeof MAINTENANCE_STATUSES)[number];

/**
 * The id of the expenses row that "mark paid" writes for a maintenance request.
 * Derived from the request id so paying is idempotent (one expense per request)
 * and so deleting the request can find and remove that exact expense. Both the
 * pay endpoint and the delete endpoint MUST use this, or a deleted report would
 * leave its cost counting in Finances.
 */
export function maintenanceExpenseId(requestId: string): string {
  return `maint-${requestId}`;
}

/** Log a status transition to maintenance_status_log. Best-effort; never blocks the caller. */
export function logStatusChange(
  db: D1Database,
  requestId: string,
  fromStatus: string | null,
  toStatus: string,
  userId?: string | null,
  userName?: string | null,
  notes?: string | null
): D1PreparedStatement {
  return db.prepare(
    `INSERT INTO maintenance_status_log (id, request_id, from_status, to_status, changed_by_id, changed_by_name, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(crypto.randomUUID(), requestId, fromStatus, toStatus, userId ?? null, userName ?? null, notes ?? null);
}

/**
 * Whether a handyman with these trades should be offered a request in this
 * category. 'general' handymen see everything; an unknown/blank category falls
 * back to 'general' so nothing silently reaches no one.
 */
export function tradeMatches(handymanTrades: string[], category: string | null | undefined): boolean {
  if (handymanTrades.includes('general')) return true;
  const cat = category && category.trim() ? category : 'general';
  return handymanTrades.includes(cat);
}
