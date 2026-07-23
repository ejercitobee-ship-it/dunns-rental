// Server-side maintenance constants and small helpers. Kept separate from the
// React app's src/lib/maintenance.ts because the functions build has its own
// tsconfig and cannot import from src.

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
