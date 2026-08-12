import { describe, it, expect } from 'vitest';
import { activeLeases, monthlyRevenue, settleMonth, leaseCoversMonth, leasesOwingMonth, paymentsForMonth, rentIncomeForYear, rentIncomeForMonths, groupLeaseMonthRows, rentMonthsToShow, monthsBehind, unsettledMonths, daysUntilLeaseEnd, isLeaseExpiringSoon } from './rent';
import type { Lease, RentPayment, MonthSettlement } from './rent';

const lease = (over: Partial<Lease> = {}): Lease => ({
  id: 'L1',
  unitId: 'U1',
  propertyId: 'P1',
  leaseType: 'fixed',
  startDate: '2026-01-01',
  endDate: '2027-01-01',
  monthlyRent: 1325,
  securityDeposit: 0,
  status: 'active',
  tenantIds: [],
  pauses: [],
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

describe('rent tracking start floor (Jan 2026)', () => {
  it('never owes a month before January 2026, even for a lease that began years earlier', () => {
    const l = lease({ startDate: '2019-06-01', endDate: undefined });
    expect(leaseCoversMonth(l, 6, 2019)).toBe(false);
    expect(leaseCoversMonth(l, 12, 2025)).toBe(false);
    expect(leaseCoversMonth(l, 1, 2026)).toBe(true);
    expect(leasesOwingMonth([l], 6, 2019)).toEqual([]);
    expect(monthsBehind(l, [], 3, 2026).months).toBe(3); // Jan, Feb, Mar 2026 only
  });
});

describe('unsettledMonths', () => {
  it('lists every owed month from the start through the target, oldest first', () => {
    // Lease starts Jan 2026, no payments; settle through March 2026 = 3 months.
    const rows = unsettledMonths(lease({ startDate: '2026-01-01' }), [], 3, 2026);
    expect(rows.map(r => `${r.year}-${r.month}`)).toEqual(['2026-1', '2026-2', '2026-3']);
    expect(rows.every(r => r.amount === 1325)).toBe(true);
  });

  it('skips months already paid and returns only the remaining balance on a partial', () => {
    const payments = [
      payment({ id: 'a', month: 1, year: 2026, amount: 1325 }), // Jan fully paid
      payment({ id: 'b', month: 2, year: 2026, amount: 300 }),  // Feb partial
    ];
    const rows = unsettledMonths(lease({ startDate: '2026-01-01' }), payments, 3, 2026);
    expect(rows).toEqual([
      { month: 2, year: 2026, amount: 1025 },
      { month: 3, year: 2026, amount: 1325 },
    ]);
  });

  it('returns nothing when the lease has no start date', () => {
    expect(unsettledMonths(lease({ startDate: undefined }), [], 3, 2026)).toEqual([]);
  });
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

describe('monthsBehind', () => {
  // Lease starts Jan 2026, rent 1325. "Now" is May 2026 (months Jan..May owed).
  const L = lease({ startDate: '2026-01-01', endDate: '2027-01-01', monthlyRent: 1325 });

  it('counts every owed month with an outstanding balance', () => {
    // Only Jan and Feb paid; Mar, Apr, May unpaid = 3 months behind.
    const paid = [
      payment({ id: 'a', month: 1, year: 2026 }),
      payment({ id: 'b', month: 2, year: 2026 }),
    ];
    const pd = monthsBehind(L, paid, 5, 2026);
    expect(pd.months).toBe(3);
    expect(pd.balance).toBe(1325 * 3);
  });

  it('is zero when everything owed so far is paid', () => {
    const paid = [1, 2, 3, 4, 5].map(m => payment({ id: `p${m}`, month: m, year: 2026 }));
    expect(monthsBehind(L, paid, 5, 2026)).toEqual({ months: 0, balance: 0 });
  });

  it('counts a partial month as behind, for the unpaid remainder', () => {
    const paid = [
      payment({ id: 'a', month: 1, year: 2026 }),
      payment({ id: 'b', month: 2, year: 2026 }),
      payment({ id: 'c', month: 3, year: 2026 }),
      payment({ id: 'd', month: 4, year: 2026 }),
      payment({ id: 'e', month: 5, year: 2026, amount: 325 }), // 1000 short
    ];
    const pd = monthsBehind(L, paid, 5, 2026);
    expect(pd.months).toBe(1);
    expect(pd.balance).toBe(1000);
  });

  it('does not count months the lease had not started', () => {
    const later = lease({ startDate: '2026-04-01', monthlyRent: 1325 });
    // Owed Apr and May only; none paid = 2 months, not 5.
    expect(monthsBehind(later, [], 5, 2026).months).toBe(2);
  });

  it('ignores a draft (needs review) lease', () => {
    expect(monthsBehind(lease({ needsReview: true }), [], 5, 2026)).toEqual({ months: 0, balance: 0 });
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

  it('has no lower bound from the lease itself, but still respects the 2026 tracking floor', () => {
    const noStart = lease({ startDate: undefined, endDate: '2027-01-01' });
    expect(leaseCoversMonth(noStart, 1, 2026)).toBe(true); // at the floor
    expect(leaseCoversMonth(noStart, 6, 2026)).toBe(true);
    expect(leaseCoversMonth(noStart, 1, 2020)).toBe(false); // before the floor, never owed
  });

  it('is true for the one month a lease both starts and ends in', () => {
    const oneMonth = lease({ startDate: '2026-04-10', endDate: '2026-04-20' });
    expect(leaseCoversMonth(oneMonth, 4, 2026)).toBe(true);
  });
});

describe('paymentsForMonth', () => {
  it('does not count a payment that is not marked paid', () => {
    const payments = [payment({ status: 'pending' })];
    expect(paymentsForMonth('L1', payments, 7, 2026)).toEqual([]);
  });

  it('does not count a partial-status payment', () => {
    // Pinned per the owner's decision: a `partial` row is not money in hand
    // for settlement purposes, `settleMonth` derives "partial" itself from
    // the amounts actually paid.
    const payments = [payment({ status: 'partial', amount: 700 })];
    expect(paymentsForMonth('L1', payments, 7, 2026)).toEqual([]);
  });
});

describe('leasesOwingMonth', () => {
  // The Critical fix: a lease ended at turnover still owed, and was paid,
  // every month its term covered before that. Filtering on activeLeases
  // instead would erase that income from the year's totals.
  it('still counts an ended lease for a month its term covered', () => {
    const ended = lease({ status: 'ended', startDate: '2026-01-01', endDate: '2026-06-30' });
    expect(leasesOwingMonth([ended], 3, 2026).map(l => l.id)).toEqual(['L1']);
  });

  it('excludes a lease whose term does not cover the month', () => {
    const notYetStarted = lease({ startDate: '2026-04-01', endDate: '2026-06-30' });
    expect(leasesOwingMonth([notYetStarted], 3, 2026)).toEqual([]);
  });

  // The owner's decision and the reason this changed from a single pausedAt
  // field to a table of intervals: a pause that has ENDED must keep the gap
  // it created unbilled forever, not just until the ceiling date. Pause June
  // 20, resume October 5: June is still owed in full (pausing mid-month bills
  // the whole month), July/August/September are the gap and stay unbilled,
  // and October is owed in full too, symmetric with how a lease starting
  // mid-month owes that whole month. November, safely past the interval, is
  // unaffected.
  it('excludes only the months strictly between a closed pause interval', () => {
    const paused = lease({
      status: 'active',
      pauses: [{ pausedAt: '2026-06-20', resumedAt: '2026-10-05' }],
      startDate: '2026-01-01',
      endDate: '2027-01-01',
    });
    expect(leasesOwingMonth([paused], 6, 2026).map(l => l.id)).toEqual(['L1']);
    expect(leasesOwingMonth([paused], 7, 2026)).toEqual([]);
    expect(leasesOwingMonth([paused], 8, 2026)).toEqual([]);
    expect(leasesOwingMonth([paused], 9, 2026)).toEqual([]);
    expect(leasesOwingMonth([paused], 10, 2026).map(l => l.id)).toEqual(['L1']);
    expect(leasesOwingMonth([paused], 11, 2026).map(l => l.id)).toEqual(['L1']);
  });

  it('excludes every month after an OPEN pause, with no resume to bound it', () => {
    const paused = lease({
      status: 'paused',
      pauses: [{ pausedAt: '2026-06-20' }],
      startDate: '2026-01-01',
      endDate: undefined,
    });
    expect(leasesOwingMonth([paused], 6, 2026).map(l => l.id)).toEqual(['L1']);
    expect(leasesOwingMonth([paused], 7, 2026)).toEqual([]);
    expect(leasesOwingMonth([paused], 12, 2026)).toEqual([]);
  });

  // What a single pausedAt field could never express: a lease paused,
  // resumed, and paused again keeps BOTH gaps unbilled, not just the most
  // recent one.
  it('keeps both gaps unbilled across two separate pause intervals', () => {
    const twicePaused = lease({
      status: 'paused',
      pauses: [
        { pausedAt: '2026-03-10', resumedAt: '2026-05-01' },
        { pausedAt: '2026-08-15' },
      ],
      startDate: '2026-01-01',
      endDate: undefined,
    });
    expect(leasesOwingMonth([twicePaused], 3, 2026).map(l => l.id)).toEqual(['L1']); // first pause month: owed
    expect(leasesOwingMonth([twicePaused], 4, 2026)).toEqual([]); // inside first gap
    expect(leasesOwingMonth([twicePaused], 5, 2026).map(l => l.id)).toEqual(['L1']); // first resume month: owed
    expect(leasesOwingMonth([twicePaused], 6, 2026).map(l => l.id)).toEqual(['L1']); // between the two intervals
    expect(leasesOwingMonth([twicePaused], 7, 2026).map(l => l.id)).toEqual(['L1']); // between the two intervals
    expect(leasesOwingMonth([twicePaused], 8, 2026).map(l => l.id)).toEqual(['L1']); // second pause month: owed
    expect(leasesOwingMonth([twicePaused], 9, 2026)).toEqual([]); // inside second (open) gap, forever
  });

  // Ending a paused lease used to resurrect the rent that was never billed,
  // because ending only stamped endDate and left the single pausedAt field
  // alone. This pins the same regression for the interval shape: an interval
  // that never got a resumedAt keeps excluding months even past the lease's
  // own end month, since the term's "end month owed in full" rule does not
  // override an unresolved pause.
  it('keeps the pause ceiling after a paused lease is ended, when the pause was never resumed', () => {
    const endedWhilePaused = lease({
      status: 'ended',
      pauses: [{ pausedAt: '2026-06-20' }],
      startDate: '2026-01-01',
      endDate: '2026-10-15',
    });
    expect(leasesOwingMonth([endedWhilePaused], 6, 2026).map(l => l.id)).toEqual(['L1']);
    expect(leasesOwingMonth([endedWhilePaused], 7, 2026)).toEqual([]);
    expect(leasesOwingMonth([endedWhilePaused], 10, 2026)).toEqual([]);
  });

  // An imported paused lease with no recorded interval (or any other legacy
  // shape that lost track of when the pause happened) must not invent a stop
  // date in either direction. Guessing "still owed in the past" would bill
  // nothing wrong here, but guessing "paused as of today" would invent rent
  // on a lease paused long ago. The only reading that cannot invent rent is
  // to owe nothing at all.
  it('treats a paused lease with an empty pauses array as owing nothing, past or present', () => {
    const paused = lease({
      status: 'paused',
      pauses: [],
      startDate: '2020-01-01',
      endDate: undefined,
    });
    expect(leasesOwingMonth([paused], 3, 2025)).toEqual([]);
    const now = new Date();
    expect(leasesOwingMonth([paused], now.getMonth() + 1, now.getFullYear())).toEqual([]);
  });

  // Fix 5: bad data (any import source, not just the UI) cannot bill an
  // ended tenant forever just because endDate was left blank.
  it('treats an ended lease with no endDate as owing nothing', () => {
    const ended = lease({ status: 'ended', startDate: '2024-01-01', endDate: undefined });
    expect(leasesOwingMonth([ended], 6, 2026)).toEqual([]);
  });
});

describe('draft (needs review) leases owe nothing', () => {
  // A realtor-created draft has no start date yet and is awaiting Belle's
  // review; it must not bill any month until she finalizes it.
  const draft = lease({ id: 'd1', startDate: undefined, endDate: undefined, needsReview: true });

  it('a needs-review lease covers no month', () => {
    expect(leaseCoversMonth(draft, 7, 2026)).toBe(false);
  });

  it('a needs-review lease is never owed', () => {
    expect(leasesOwingMonth([draft], 7, 2026)).toEqual([]);
  });

  it('once finalized (needsReview false) it covers again', () => {
    expect(leaseCoversMonth({ ...draft, needsReview: false, startDate: '2026-01-01' }, 7, 2026)).toBe(true);
  });

  it('settleMonth bills a needs-review lease nothing even if called directly', () => {
    const s = settleMonth(draft, [], 7, 2026);
    expect(s.due).toBe(0);
    expect(s.balance).toBe(0);
  });
});

describe('rentIncomeForYear', () => {
  it('sums paid payments for the year and ignores non-paid ones', () => {
    const payments = [
      payment({ id: 'A', status: 'paid', amount: 1000, year: 2026 }),
      payment({ id: 'B', status: 'pending', amount: 500, year: 2026 }),
      payment({ id: 'C', status: 'partial', amount: 300, year: 2026 }),
      payment({ id: 'D', status: 'overdue', amount: 900, year: 2026 }),
    ];
    expect(rentIncomeForYear(payments, 2026)).toBe(1000);
  });

  // The Tax tab shows four quarters above a total. They have to reconcile, so
  // the quarters are scoped by month using the same paid-only definition the
  // total uses. The payment in month 11 belongs to no lease's owed term here,
  // which is exactly the case that used to make the quarters fall short.
  it('splits into quarters that add back up to the year', () => {
    const payments = [
      payment({ id: 'A', status: 'paid', amount: 1000, month: 2, year: 2026 }),
      payment({ id: 'B', status: 'paid', amount: 250.5, month: 5, year: 2026 }),
      payment({ id: 'C', status: 'paid', amount: 700, month: 8, year: 2026 }),
      payment({ id: 'D', status: 'paid', amount: 49.5, month: 11, year: 2026 }),
      payment({ id: 'E', status: 'pending', amount: 999, month: 11, year: 2026 }),
      payment({ id: 'F', status: 'paid', amount: 5000, month: 2, year: 2025 }),
    ];
    const quarters = [[1, 2, 3], [4, 5, 6], [7, 8, 9], [10, 11, 12]];
    const byQuarter = quarters.map(months => rentIncomeForMonths(payments, months, 2026));
    expect(byQuarter).toEqual([1000, 250.5, 700, 49.5]);
    const summed = byQuarter.reduce((sum, q) => sum + q, 0);
    expect(summed).toBe(rentIncomeForYear(payments, 2026));
  });

  it('ignores payments from other years', () => {
    const payments = [
      payment({ id: 'A', status: 'paid', amount: 1000, year: 2025 }),
      payment({ id: 'B', status: 'paid', amount: 2000, year: 2026 }),
    ];
    expect(rentIncomeForYear(payments, 2026)).toBe(2000);
  });

  it('counts a paid payment even when its month falls outside any lease boundary', () => {
    // A payment can be recorded against a month after a lease's endDate (bad
    // data, or a late payment for a stay that already ended). For tax
    // purposes the cash received IS the income regardless, so this still
    // counts even though leasesOwingMonth would exclude that lease-month.
    const payments = [payment({ id: 'A', status: 'paid', amount: 1325, month: 12, year: 2026 })];
    expect(rentIncomeForYear(payments, 2026)).toBe(1325);
  });

  it('returns 0 with no paid payments', () => {
    expect(rentIncomeForYear([payment({ status: 'pending' })], 2026)).toBe(0);
  });
});

describe('groupLeaseMonthRows', () => {
  const settle = (over: Partial<MonthSettlement> = {}): MonthSettlement => ({
    due: 1000, paid: 0, balance: 1000, status: 'unpaid', ...over,
  });
  const paid = settle({ paid: 1000, balance: 0, status: 'paid' });
  // Minimal row: the helper only reads lease/month/settlement, plus whatever
  // extra the caller carries through (here, a `tag` to prove pass-through).
  const row = (leaseId: string, month: number, s: MonthSettlement, tag = '') =>
    ({ lease: lease({ id: leaseId }), month, settlement: s, tag });

  it('collapses each lease into one group, months sorted ascending', () => {
    const rows = [row('L1', 7, paid), row('L1', 5, paid), row('L2', 6, paid)];
    const groups = groupLeaseMonthRows(rows, 2026, 2026, 7);
    expect(groups).toHaveLength(2);
    const g1 = groups.find(g => g.lease.id === 'L1')!;
    expect(g1.monthRows.map(r => r.month)).toEqual([5, 7]);
  });

  it('picks this month only in the current year', () => {
    const rows = [row('L1', 6, paid), row('L1', 7, settle())];
    expect(groupLeaseMonthRows(rows, 2026, 2026, 7)[0].thisMonth?.month).toBe(7);
    expect(groupLeaseMonthRows(rows, 2025, 2026, 7)[0].thisMonth).toBeNull();
    expect(groupLeaseMonthRows(rows, 2027, 2026, 7)[0].thisMonth).toBeNull();
  });

  it('sums overdue from elapsed months before the current one, excluding this and future months', () => {
    const rows = [
      row('L1', 5, settle({ balance: 400, status: 'partial', paid: 600 })),
      row('L1', 6, settle({ balance: 1000 })),
      row('L1', 7, settle({ balance: 1000 })),  // current month: not overdue
      row('L1', 8, settle({ balance: 1000 })),  // future month: not yet due
    ];
    const g = groupLeaseMonthRows(rows, 2026, 2026, 7)[0];
    expect(g.overdue).toBe(1400);
  });

  it('treats every unpaid month of a past year as overdue', () => {
    const rows = [row('L1', 1, settle()), row('L1', 12, settle())];
    expect(groupLeaseMonthRows(rows, 2025, 2026, 7)[0].overdue).toBe(2000);
  });

  it('flags attention for overdue or an unpaid current month, and clears it when settled', () => {
    const overdueOnly = [row('L1', 6, settle()), row('L1', 7, paid)];
    const thisMonthOnly = [row('L1', 6, paid), row('L1', 7, settle())];
    const allPaid = [row('L1', 6, paid), row('L1', 7, paid)];
    expect(groupLeaseMonthRows(overdueOnly, 2026, 2026, 7)[0].needsAttention).toBe(true);
    expect(groupLeaseMonthRows(thisMonthOnly, 2026, 2026, 7)[0].needsAttention).toBe(true);
    expect(groupLeaseMonthRows(allPaid, 2026, 2026, 7)[0].needsAttention).toBe(false);
  });

  it('sorts attention groups first while preserving incoming order within a bucket', () => {
    const rows = [
      row('PAID_A', 7, paid),
      row('OWES_B', 7, settle()),
      row('PAID_C', 7, paid),
      row('OWES_D', 7, settle()),
    ];
    const ids = groupLeaseMonthRows(rows, 2026, 2026, 7).map(g => g.lease.id);
    expect(ids).toEqual(['OWES_B', 'OWES_D', 'PAID_A', 'PAID_C']);
  });

  it('carries caller fields through untouched', () => {
    const groups = groupLeaseMonthRows([row('L1', 7, paid, 'hello')], 2026, 2026, 7);
    expect(groups[0].monthRows[0].tag).toBe('hello');
  });
});

describe('rentMonthsToShow', () => {
  // lease() runs Jan 2026 -> Jan 2027; "today" is July 2026 in these tests.
  it('lists owed months from the lease start through the current month', () => {
    const res = rentMonthsToShow(lease(), [], 2026, 7);
    expect(res).toEqual([1, 2, 3, 4, 5, 6, 7].map(m => ({ month: m, year: 2026 })));
  });

  it('includes a FUTURE month that has an advance payment', () => {
    const res = rentMonthsToShow(lease(), [payment({ month: 8, year: 2026 })], 2026, 7);
    expect(res.some(r => r.month === 8 && r.year === 2026)).toBe(true);
    // The last shown month is the advance one, not just the current month.
    expect(res[res.length - 1]).toEqual({ month: 8, year: 2026 });
  });

  it('does not show a future month with no payment (not due yet)', () => {
    const res = rentMonthsToShow(lease(), [payment({ month: 8, year: 2026 })], 2026, 7);
    expect(res.some(r => r.month === 9 && r.year === 2026)).toBe(false);
  });

  it('shows the paid advance months and skips an unpaid future month between them', () => {
    // Paid Aug and Oct ahead, skipping Sep. Sep is future and unpaid, so it is
    // not shown (never present a not-yet-due month as owing); Aug and Oct are.
    const payments = [payment({ month: 8, year: 2026 }), payment({ month: 10, year: 2026 })];
    const res = rentMonthsToShow(lease(), payments, 2026, 7);
    expect(res.map(r => r.month)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 10]);
  });
});

describe('daysUntilLeaseEnd', () => {
  it('counts whole local days to the end date', () => {
    expect(daysUntilLeaseEnd(lease({ endDate: '2026-07-31' }), '2026-07-27')).toBe(4);
  });
  it('is negative once the end date has passed', () => {
    expect(daysUntilLeaseEnd(lease({ endDate: '2026-07-20' }), '2026-07-27')).toBe(-7);
  });
  it('is null when there is no end date', () => {
    expect(daysUntilLeaseEnd(lease({ endDate: undefined }), '2026-07-27')).toBeNull();
  });
});

describe('isLeaseExpiringSoon', () => {
  it('flags an active lease ending within 60 days', () => {
    expect(isLeaseExpiringSoon(lease({ endDate: '2026-09-01' }), '2026-07-27')).toBe(true);
  });
  it('includes a lease ending today', () => {
    expect(isLeaseExpiringSoon(lease({ endDate: '2026-07-27' }), '2026-07-27')).toBe(true);
  });
  it('excludes a lease more than 60 days out', () => {
    expect(isLeaseExpiringSoon(lease({ endDate: '2026-11-01' }), '2026-07-27')).toBe(false);
  });
  it('excludes a lease that already expired', () => {
    expect(isLeaseExpiringSoon(lease({ endDate: '2026-07-01' }), '2026-07-27')).toBe(false);
  });
  it('excludes non-active leases even if the date is near', () => {
    expect(isLeaseExpiringSoon(lease({ endDate: '2026-08-01', status: 'ended' }), '2026-07-27')).toBe(false);
    expect(isLeaseExpiringSoon(lease({ endDate: '2026-08-01', status: 'paused' }), '2026-07-27')).toBe(false);
  });
  it('is false when there is no end date', () => {
    expect(isLeaseExpiringSoon(lease({ endDate: undefined }), '2026-07-27')).toBe(false);
  });
});
