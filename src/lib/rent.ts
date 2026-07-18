// The single source of truth for rent math. Every page reads from here so the
// Dashboard, Rents, Reports and Tax Report cannot disagree with each other.
//
// Task 6 moves Lease and RentPayment into src/types and this file imports them
// instead of declaring them.

import type { Lease, RentPayment } from '../types';
export type { Lease, RentPayment };

export interface MonthSettlement {
  due: number;
  paid: number;
  balance: number;
  status: 'paid' | 'partial' | 'unpaid';
}

/** Money is compared to the cent; anything closer than half a cent is equal. */
const EPSILON = 0.005;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function activeLeases(leases: Lease[]): Lease[] {
  return leases.filter(l => l.status === 'active');
}

/**
 * Parses the leading "YYYY-MM" of an ISO date string as plain numbers, with
 * no `Date` object and no timezone shift. `new Date('2026-04-10')` is UTC
 * midnight and can land in the previous month for a user behind UTC, which
 * would wrongly exclude the start month from a lease's coverage.
 */
function yearMonthOf(dateStr: string): number {
  const [year, month] = dateStr.split('-').map(Number);
  return year * 12 + month;
}

/**
 * Whether a lease's term overlaps a given month at all, no proration: a
 * lease that starts or ends mid-month owes the whole month on either end.
 * A missing `startDate` means no lower bound; a missing `endDate` means the
 * lease is ongoing and has no upper bound. The start and end months are
 * both inclusive.
 */
export function leaseCoversMonth(lease: Lease, month: number, year: number): boolean {
  // A draft lease a realtor created (awaiting Belle's review) owes no rent
  // anywhere until she finalizes it. Excluding it here, the coverage
  // primitive, keeps it out of leasesOwingMonth AND settleMonth at once, so a
  // draft (which has a null start date) never bills every month by mistake.
  if (lease.needsReview) return false;
  const target = year * 12 + month;
  if (lease.startDate && target < yearMonthOf(lease.startDate)) return false;
  if (lease.endDate && target > yearMonthOf(lease.endDate)) return false;
  return true;
}

/**
 * Whether one pause interval excludes a given target month. The month the
 * pause STARTS in is still owed in full, symmetric with how a lease's own
 * start month is owed in full: pausing mid-June still bills all of June, so
 * only months STRICTLY AFTER `pausedAt`'s month are candidates for exclusion.
 * If the interval has closed (`resumedAt` set), the month it RESUMES in is
 * likewise owed in full, exactly like a lease starting mid-month owes that
 * whole month, so only months STRICTLY BEFORE `resumedAt`'s month are
 * excluded. An OPEN interval (no `resumedAt`) has no upper bound: it excludes
 * every month after its own start, forever.
 */
function monthIsPaused(pause: { pausedAt: string; resumedAt?: string }, target: number): boolean {
  const pausedMonth = yearMonthOf(pause.pausedAt);
  if (target <= pausedMonth) return false;
  if (!pause.resumedAt) return true;
  return target < yearMonthOf(pause.resumedAt);
}

/**
 * Every lease that OWED rent for one historical month. This is the question a
 * month walk must ask, and `activeLeases` is not it: a lease ended at turnover
 * in June still owed (and was paid) January through June, so filtering it out
 * would erase half a year of income from the Rent Management, Dashboard and
 * Tax Report figures. Use this for anything historical; use `activeLeases`
 * only for forward-looking figures (what is billed from now on).
 *
 * The rules, in order:
 *  - the term has to cover the month at all (`leaseCoversMonth`). Ending a
 *    lease stamps `endDate` to that day, so months after the tenant left are
 *    excluded by the term, not by the status. An `ended` lease with no
 *    `endDate` at all (bad data: the UI always stamps one) has no known
 *    upper bound to trust, so it is treated as owing nothing rather than
 *    billing forever.
 *  - a lease whose status is `paused` but which has NO recorded pause
 *    interval at all (legacy or bad data, e.g. an old single-field record
 *    that never migrated) has no known date rent stopped, so it owes
 *    nothing at all, past or present, the moment it is read as paused:
 *    guessing a stop date, in either direction, would either invent rent the
 *    owner never billed or erase rent she actually collected.
 *  - a month is not owed if it falls inside ANY of the lease's pause
 *    intervals (`monthIsPaused`), regardless of the lease's CURRENT status.
 *    A lease can be paused, resumed, and paused again, and each gap has to
 *    stay unbilled on its own: a single field could only ever remember the
 *    most recent pause, so a second one would silently overwrite the first
 *    and re-bill that gap. This also covers a lease that was ended while
 *    still paused (only resuming or ending closes an interval, so an
 *    unresolved one keeps excluding months even past the lease's own end
 *    month).
 */
export function leasesOwingMonth(leases: Lease[], month: number, year: number): Lease[] {
  const target = year * 12 + month;

  return leases.filter(lease => {
    if (!leaseCoversMonth(lease, month, year)) return false;
    if (lease.status === 'ended' && !lease.endDate) return false;
    if (lease.status === 'paused' && lease.pauses.length === 0) return false;
    if (lease.pauses.some(p => monthIsPaused(p, target))) return false;
    return true;
  });
}

/**
 * Total rent per month across active leases. Counted once per lease, which is
 * what stops income doubling when more than one person lives in a unit.
 */
export function monthlyRevenue(leases: Lease[]): number {
  return round2(activeLeases(leases).reduce((sum, l) => sum + (l.monthlyRent || 0), 0));
}

/**
 * Money actually received against one lease for one month.
 *
 * Only `status === 'paid'` counts. This is the ONE rule for what "collected"
 * means, and it is the same rule the Dashboard, Reports and Tax Report use.
 * Before this, settlement summed every payment row whatever its status, so an
 * imported row marked `pending` showed the month as Paid on Rent Management
 * while every other page showed $0 collected for it.
 */
export function paymentsForMonth(
  leaseId: string,
  payments: RentPayment[],
  month: number,
  year: number
): RentPayment[] {
  return payments.filter(
    p => p.leaseId === leaseId && p.month === month && p.year === year && p.status === 'paid'
  );
}

/**
 * Total rent actually received in a calendar year, with no LEASE filter at
 * all. For tax purposes the money received IS the income, whatever month it
 * was recorded against: a payment posted against a month outside any lease's
 * owed term (say, one entered after a lease's `endDate`) still counts,
 * because the cash came in that year regardless. This is the ONE definition
 * of taxable rent income; the Tax Report page and Rent Management's Tax tab
 * both call this instead of summing payments themselves, so the two figures
 * cannot drift apart.
 *
 * It does assume a payment's month is 1..12, which is what lets the Tax tab's
 * four quarters add up to it. `rent_payments.month` carries a matching CHECK
 * constraint and the payments API rejects a missing month, so a month outside
 * that range cannot be stored.
 */
export function rentIncomeForYear(payments: RentPayment[], year: number): number {
  return rentIncomeForMonths(payments, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], year);
}

/**
 * The same definition as `rentIncomeForYear`, narrowed to some months of the
 * year. The Tax tab's quarters use this so they add up to its own total: they
 * were settlement based while the total was payment based, so a payment
 * recorded outside any owed month made the four quarters sum to less than the
 * total sitting above them on the same screen.
 */
export function rentIncomeForMonths(
  payments: RentPayment[],
  months: number[],
  year: number
): number {
  return round2(
    payments
      .filter(p => p.status === 'paid' && p.year === year && months.includes(p.month))
      .reduce((sum, p) => sum + (p.amount || 0), 0)
  );
}

/**
 * What is owed, what came in, and whether the month is settled. Several
 * payments may add up to one month's rent (roommates splitting it).
 */
export function settleMonth(
  lease: Lease,
  payments: RentPayment[],
  month: number,
  year: number
): MonthSettlement {
  const due = round2(lease.monthlyRent || 0);
  const paid = round2(
    paymentsForMonth(lease.id, payments, month, year).reduce((sum, p) => sum + (p.amount || 0), 0)
  );

  if (paid <= 0) return { due, paid: 0, balance: due, status: 'unpaid' };
  if (paid + EPSILON >= due) return { due, paid, balance: 0, status: 'paid' };
  return { due, paid, balance: round2(due - paid), status: 'partial' };
}
