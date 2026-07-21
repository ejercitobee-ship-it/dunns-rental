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
 * Whether a handyman with these trades should be offered a request in this
 * category. 'general' handymen see everything; an unknown/blank category falls
 * back to 'general' so nothing silently reaches no one.
 */
export function tradeMatches(handymanTrades: string[], category: string | null | undefined): boolean {
  if (handymanTrades.includes('general')) return true;
  const cat = category && category.trim() ? category : 'general';
  return handymanTrades.includes(cat);
}
