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
