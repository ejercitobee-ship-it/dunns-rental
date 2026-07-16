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
  const target = year * 12 + month;
  if (lease.startDate && target < yearMonthOf(lease.startDate)) return false;
  if (lease.endDate && target > yearMonthOf(lease.endDate)) return false;
  return true;
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
 *    excluded by the term, not by the status.
 *  - a paused lease owed rent for every month strictly BEFORE the month it was
 *    paused in. The pause stops rent from that point on, it does not rewrite
 *    the months the tenant already lived there.
 *  - a paused lease with no `pausedAt` (legacy or bad data) is treated as
 *    paused from the current month onward: past months still owe, the current
 *    month and later do not. That is the reading that cannot invent rent the
 *    owner never agreed to bill.
 */
export function leasesOwingMonth(leases: Lease[], month: number, year: number): Lease[] {
  const target = year * 12 + month;
  const now = new Date();
  // Local time on purpose: the owner's "this month" is America/Chicago, not UTC.
  const currentYearMonth = now.getFullYear() * 12 + (now.getMonth() + 1);

  return leases.filter(lease => {
    if (!leaseCoversMonth(lease, month, year)) return false;
    if (lease.status !== 'paused') return true;
    const pausedYearMonth = lease.pausedAt ? yearMonthOf(lease.pausedAt) : currentYearMonth;
    return target < pausedYearMonth;
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
