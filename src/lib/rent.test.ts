import { describe, it, expect } from 'vitest';
import { activeLeases, monthlyRevenue, settleMonth, leaseCoversMonth } from './rent';
import type { Lease, RentPayment } from './rent';

const lease = (over: Partial<Lease> = {}): Lease => ({
  id: 'L1',
  unitId: 'U1',
  propertyId: 'P1',
  startDate: '2026-01-01',
  endDate: '2027-01-01',
  monthlyRent: 1325,
  securityDeposit: 0,
  status: 'active',
  tenantIds: [],
  ...over,
});

const payment = (over: Partial<RentPayment> = {}): RentPayment => ({
  id: 'PMT1',
  leaseId: 'L1',
  amount: 1325,
  month: 7,
  year: 2026,
  status: 'paid',
  ...over,
});

describe('monthlyRevenue', () => {
  it('counts a lease once no matter how many people live there', () => {
    // The double-counting bug: two occupants must not mean two rents.
    expect(monthlyRevenue([lease()])).toBe(1325);
  });

  it('adds up multiple active leases', () => {
    expect(monthlyRevenue([lease(), lease({ id: 'L2', monthlyRent: 1300 })])).toBe(2625);
  });

  it('ignores ended and paused leases', () => {
    const leases = [
      lease(),
      lease({ id: 'L2', status: 'ended', monthlyRent: 999 }),
      lease({ id: 'L3', status: 'paused', monthlyRent: 888 }),
    ];
    expect(monthlyRevenue(leases)).toBe(1325);
  });

  it('returns 0 with no leases', () => {
    expect(monthlyRevenue([])).toBe(0);
  });
});

describe('activeLeases', () => {
  it('returns only active leases', () => {
    const result = activeLeases([lease(), lease({ id: 'L2', status: 'ended' })]);
    expect(result.map(l => l.id)).toEqual(['L1']);
  });
});

describe('settleMonth', () => {
  it('settles when one person pays in full', () => {
    const s = settleMonth(lease(), [payment()], 7, 2026);
    expect(s).toEqual({ due: 1325, paid: 1325, balance: 0, status: 'paid' });
  });

  it('settles when roommates split the month and it adds up', () => {
    const payments = [
      payment({ id: 'A', amount: 700, paidByTenantId: 'T1' }),
      payment({ id: 'B', amount: 625, paidByTenantId: 'T2' }),
    ];
    const s = settleMonth(lease(), payments, 7, 2026);
    expect(s.paid).toBe(1325);
    expect(s.status).toBe('paid');
    expect(s.balance).toBe(0);
  });

  it('reports partial with the remaining balance when short', () => {
    const s = settleMonth(lease(), [payment({ amount: 700 })], 7, 2026);
    expect(s).toEqual({ due: 1325, paid: 700, balance: 625, status: 'partial' });
  });

  it('reports unpaid when nothing was paid', () => {
    const s = settleMonth(lease(), [], 7, 2026);
    expect(s).toEqual({ due: 1325, paid: 0, balance: 1325, status: 'unpaid' });
  });

  it('ignores payments from other months, years and leases', () => {
    const payments = [
      payment({ id: 'A', month: 6 }),
      payment({ id: 'B', year: 2025 }),
      payment({ id: 'C', leaseId: 'OTHER' }),
    ];
    expect(settleMonth(lease(), payments, 7, 2026).paid).toBe(0);
  });

  it('does not fail on floating point drift', () => {
    const payments = [
      payment({ id: 'A', amount: 441.66 }),
      payment({ id: 'B', amount: 441.67 }),
      payment({ id: 'C', amount: 441.67 }),
    ];
    const s = settleMonth(lease({ monthlyRent: 1325 }), payments, 7, 2026);
    expect(s.status).toBe('paid');
    expect(s.balance).toBe(0);
  });

  it('treats overpayment as paid with no negative balance', () => {
    const s = settleMonth(lease(), [payment({ amount: 1400 })], 7, 2026);
    expect(s.status).toBe('paid');
    expect(s.balance).toBe(0);
  });
});

describe('leaseCoversMonth', () => {
  // A lease starting April 10 and ending August 20: full months either way,
  // no proration.
  const midYearLease = lease({ startDate: '2026-04-10', endDate: '2026-08-20' });

  it('is false for a month before the start', () => {
    expect(leaseCoversMonth(midYearLease, 3, 2026)).toBe(false);
  });

  it('is true for the start month itself', () => {
    expect(leaseCoversMonth(midYearLease, 4, 2026)).toBe(true);
  });

  it('is true for a month in the middle of the term', () => {
    expect(leaseCoversMonth(midYearLease, 6, 2026)).toBe(true);
  });

  it('is true for the end month itself', () => {
    expect(leaseCoversMonth(midYearLease, 8, 2026)).toBe(true);
  });

  it('is false for a month after the end', () => {
    expect(leaseCoversMonth(midYearLease, 9, 2026)).toBe(false);
  });

  it('is true far in the future when there is no endDate', () => {
    const ongoing = lease({ startDate: '2026-04-10', endDate: undefined });
    expect(leaseCoversMonth(ongoing, 12, 2030)).toBe(true);
  });

  it('is true with no lower bound when there is no startDate', () => {
    const noStart = lease({ startDate: undefined, endDate: '2027-01-01' });
    expect(leaseCoversMonth(noStart, 1, 2020)).toBe(true);
  });

  it('is true for the one month a lease both starts and ends in', () => {
    const oneMonth = lease({ startDate: '2026-04-10', endDate: '2026-04-20' });
    expect(leaseCoversMonth(oneMonth, 4, 2026)).toBe(true);
  });
});
