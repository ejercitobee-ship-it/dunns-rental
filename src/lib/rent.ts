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
 * Total rent per month across active leases. Counted once per lease, which is
 * what stops income doubling when more than one person lives in a unit.
 */
export function monthlyRevenue(leases: Lease[]): number {
  return round2(activeLeases(leases).reduce((sum, l) => sum + (l.monthlyRent || 0), 0));
}

/** Payments recorded against one lease for one month. */
export function paymentsForMonth(
  leaseId: string,
  payments: RentPayment[],
  month: number,
  year: number
): RentPayment[] {
  return payments.filter(p => p.leaseId === leaseId && p.month === month && p.year === year);
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
