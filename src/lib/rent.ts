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
 *    excluded by the term, not by the status. An `ended` lease with no
 *    `endDate` at all (bad data: the UI always stamps one) has no known
 *    upper bound to trust, so it is treated as owing nothing rather than
 *    billing forever.
 *  - a paused lease owed rent through the month it was paused in, same as an
 *    ended lease owes its whole end month: pausing mid-June still bills all
 *    of June. The pause only stops rent starting the month AFTER the pause,
 *    it does not rewrite the month the tenant was paused in or any month
 *    before it.
 *  - a paused lease with no `pausedAt` (legacy or bad data) has no known date
 *    rent stopped, so it owes nothing at all from the moment it is read as
 *    paused: guessing a stop date, in either direction, would either invent
 *    rent the owner never billed or erase rent she actually collected.
 */
export function leasesOwingMonth(leases: Lease[], month: number, year: number): Lease[] {
  const target = year * 12 + month;

  return leases.filter(lease => {
    if (!leaseCoversMonth(lease, month, year)) return false;
    if (lease.status === 'ended' && !lease.endDate) return false;
    if (lease.status !== 'paused') return true;
    if (!lease.pausedAt) return false;
    return target <= yearMonthOf(lease.pausedAt);
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
 * Total rent actually received in a calendar year, no lease or month filter
 * at all. For tax purposes the money received IS the income, whatever month
 * it was recorded against: a payment posted against a month outside any
 * lease's owed term (say, one entered after a lease's `endDate`) still
 * counts, because the cash came in that year regardless. This is the ONE
 * definition of taxable rent income; the Tax Report page and Rent
 * Management's Tax tab both call this instead of summing payments
 * themselves, so the two figures cannot drift apart.
 */
export function rentIncomeForYear(payments: RentPayment[], year: number): number {
  return round2(
    payments
      .filter(p => p.status === 'paid' && p.year === year)
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
