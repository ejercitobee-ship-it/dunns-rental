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

/**
 * The business started tracking rent in the app in January 2026. No rent is ever
 * owed for a month before this, no matter how far back a lease actually started,
 * so a tenant entered with a real move-in date from years ago does not show
 * years of back rent. "Start fresh this year." Change the year here to move the
 * cutoff. Stored as a YYYY*12+MM ordinal to compare against month targets.
 */
export const RENT_TRACKING_START = 2026 * 12 + 1; // January 2026

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
  // A pending or rejected renewal lease must not bill rent. Only approved
  // renewals are active for billing. Without this check both the old and new
  // lease count for the same months, doubling the tenant's owed rent.
  if (lease.renewalStatus === 'pending' || lease.renewalStatus === 'rejected' || lease.renewalStatus === 'draft' || lease.renewalStatus === 'cancelled') return false;
  const target = year * 12 + month;
  // Nothing before the fresh-start cutoff is ever owed, regardless of how far
  // back the lease began.
  if (target < RENT_TRACKING_START) return false;
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

  const owing = leases.filter(lease => {
    if (!leaseCoversMonth(lease, month, year)) return false;
    if (lease.status === 'ended' && !lease.endDate) return false;
    if (lease.status === 'paused' && lease.pauses.length === 0) return false;
    if (lease.pauses.some(p => monthIsPaused(p, target))) return false;
    return true;
  });

  // When a renewal starts in the same month the old lease ends, both cover
  // that month. Only the old lease should bill it (the tenant already owed at
  // the old rate); the renewal starts billing the following month. Without
  // this, the tenant sees two rent entries for the overlap month.
  if (owing.length > 1) {
    return owing.filter(renewal => {
      if (!renewal.renewedFromLeaseId) return true;
      // If the old lease is also in the owing list for this month, skip the
      // renewal so the month is billed only once at the old rate.
      return !owing.some(old => old.id === renewal.renewedFromLeaseId);
    });
  }

  return owing;
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
      .filter(p => p.status === 'paid' && p.year === year && months.includes(p.month)
        && p.type !== 'credit') // Credits settle rent but are not income.
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
  // A draft lease a realtor created (awaiting review) owes nothing until Belle
  // finalizes it, enforced here too so no caller can bill it by skipping the
  // leasesOwingMonth gate.
  if (lease.needsReview) return { due: 0, paid: 0, balance: 0, status: 'paid' };
  // Same safety net for unapproved renewals: a pending/rejected/draft renewal
  // must never bill rent, even if a caller bypasses leasesOwingMonth.
  if (lease.renewalStatus === 'pending' || lease.renewalStatus === 'rejected' || lease.renewalStatus === 'draft' || lease.renewalStatus === 'cancelled')
    return { due: 0, paid: 0, balance: 0, status: 'paid' };
  const due = round2(lease.monthlyRent || 0);
  const paid = round2(
    paymentsForMonth(lease.id, payments, month, year).reduce((sum, p) => sum + (p.amount || 0), 0)
  );

  if (paid <= 0) return { due, paid: 0, balance: due, status: 'unpaid' };
  if (paid + EPSILON >= due) return { due, paid, balance: 0, status: 'paid' };
  return { due, paid, balance: round2(due - paid), status: 'partial' };
}

/** A lease is flagged past due once it owes this many months or more. */
export const PAST_DUE_MONTHS = 2;

/** A lease counts as "expiring soon" once its end date is within this many days. */
export const LEASE_EXPIRING_SOON_DAYS = 60;

/**
 * Whole calendar days from `today` (a local YYYY-MM-DD) to the lease's end date.
 * null when the lease has no end date; negative once the end date has passed.
 * Local calendar days only, via Date.UTC on the parts (never new Date(dateOnly),
 * which would read the string as midnight UTC and shift a day in some zones).
 */
export function daysUntilLeaseEnd(lease: Lease, today: string): number | null {
  if (!lease.endDate) return null;
  const toUTC = (d: string) => {
    const [y, m, day] = d.split('-').map(Number);
    return Date.UTC(y, m - 1, day);
  };
  return Math.round((toUTC(lease.endDate) - toUTC(today)) / 86400000);
}

/**
 * An active lease whose contract ends within the next LEASE_EXPIRING_SOON_DAYS
 * days and has not already lapsed. This is the office's renewal heads-up, shared
 * by the Dashboard section and the Tenants "Expiring Soon" filter so the two
 * always agree.
 */
export function isLeaseExpiringSoon(lease: Lease, today: string): boolean {
  if (lease.status !== 'active') return false;
  const d = daysUntilLeaseEnd(lease, today);
  return d !== null && d >= 0 && d <= LEASE_EXPIRING_SOON_DAYS;
}

export interface PastDue {
  /** How many owed months (up to and including now) are unpaid or partial. */
  months: number;
  /** The total outstanding balance across those months. */
  balance: number;
}

/**
 * Settle every owed month for a lease from `from` through `through`, carrying
 * overpayments forward: when a month's payments exceed its rent, the excess
 * reduces the balance of the next owed month rather than vanishing. The carry
 * is pure math on top of `settleMonth` and never changes what `paid` means
 * for tax / income (those sum raw payment records, not settlements).
 *
 * Returns an array of `{ ym, settlement }` for each owed month, in
 * chronological order, with balances adjusted for the carry.
 */
export function settleWithCarryForward(
  lease: Lease,
  payments: RentPayment[],
  from: number,
  through: number,
  leaseSet: Lease[]
): Array<{ ym: number; settlement: MonthSettlement }> {
  const out: Array<{ ym: number; settlement: MonthSettlement }> = [];
  let credit = 0;

  for (let t = from; t <= through; t++) {
    const year = Math.floor((t - 1) / 12);
    const month = t - year * 12;
    const owing = leasesOwingMonth(leaseSet, month, year);
    if (!owing.some(l => l.id === lease.id)) continue;

    const base = settleMonth(lease, payments, month, year);

    // Apply accumulated credit to an unpaid or partial month.
    if (credit > EPSILON && base.balance > EPSILON) {
      const applied = round2(Math.min(credit, base.balance));
      credit = round2(credit - applied);
      const effectivePaid = round2(base.paid + applied);
      const newBalance = round2(base.balance - applied);
      out.push({
        ym: t,
        settlement: {
          due: base.due,
          paid: effectivePaid,
          balance: Math.max(0, newBalance),
          status: newBalance <= EPSILON ? 'paid' : 'partial',
        },
      });
    } else {
      out.push({ ym: t, settlement: base });
      // Accumulate any overpayment as credit for the next month.
      if (base.paid > base.due + EPSILON) {
        credit = round2(credit + base.paid - base.due);
      }
    }
  }

  return out;
}

/**
 * Convenience: settle a single month with carry-forward from all prior months.
 * Slower than `settleMonth` (loops from lease start), but the window is small
 * (capped at tracking start, typically a few months) so it is fine for the
 * handful of single-month callers on profile and portal pages.
 */
export function settleMonthWithCredit(
  lease: Lease,
  payments: RentPayment[],
  month: number,
  year: number,
  leaseSet?: Lease[]
): MonthSettlement {
  if (!lease.startDate) return settleMonth(lease, payments, month, year);
  const target = year * 12 + month;
  const from = Math.max(yearMonthOf(lease.startDate), RENT_TRACKING_START);
  const all = settleWithCarryForward(lease, payments, from, target, leaseSet || [lease]);
  const found = all.find(e => e.ym === target);
  return found ? found.settlement : settleMonth(lease, payments, month, year);
}

/**
 * How far behind a lease is: the count of months it actually owed (term covers
 * it, not paused) from the lease start through the current month that are not
 * fully paid, plus the total outstanding. Same owed-month rule as the rest of
 * the app (leasesOwingMonth) and the same settlement (settleMonth), so this
 * cannot disagree with the Rent Management numbers. The window is capped so a
 * very old lease cannot loop unbounded.
 *
 * Overpayment carry-forward: if a month is overpaid, the excess reduces the
 * balance of later months. This prevents lump-sum payments from creating
 * false past-due flags when the money was recorded against a single month.
 *
 * `siblingLeases` — see `unsettledMonths`. When provided, renewal overlap
 * de-duplication uses the full set instead of `[lease]` alone.
 */
export function monthsBehind(
  lease: Lease,
  payments: RentPayment[],
  currentMonth: number,
  currentYear: number,
  siblingLeases?: Lease[]
): PastDue {
  if (!lease.startDate || lease.needsReview) return { months: 0, balance: 0 };
  if (lease.renewalStatus === 'pending' || lease.renewalStatus === 'rejected' || lease.renewalStatus === 'draft' || lease.renewalStatus === 'cancelled')
    return { months: 0, balance: 0 };
  const leaseSet = siblingLeases || [lease];
  const currentTarget = currentYear * 12 + currentMonth;
  const from = Math.max(yearMonthOf(lease.startDate), currentTarget - 60);

  let months = 0;
  let balance = 0;
  for (const { settlement } of settleWithCarryForward(lease, payments, from, currentTarget, leaseSet)) {
    if (settlement.balance > EPSILON) {
      months += 1;
      balance = round2(balance + settlement.balance);
    }
  }
  return { months, balance };
}

/**
 * Every owed-but-unpaid month for a lease from its start through a target
 * month, with the exact remaining balance for each. Powers the one-click
 * "mark rent paid through …" action used when a tenant is entered with a
 * backdated start date and is already paid up. Skips months the lease does not
 * owe (out of term, or paused) and months already settled, so running it is
 * idempotent. Returns them oldest first.
 *
 * Overpayment carry-forward: excess from one month reduces the balance of
 * the next, so a lump-sum payment does not leave later months unsettled.
 *
 * `siblingLeases` (optional): all leases for the same tenant / unit. When
 * provided, `leasesOwingMonth` uses the full set for its renewal overlap
 * de-duplication, so a renewal that starts in the same month as the old lease
 * ends is correctly excluded from that month. Without this, a caller that
 * passes only `[lease]` (e.g. TenantDetail) defeats the de-duplication and
 * the new lease shows the overlap month as owed.
 */
export function unsettledMonths(
  lease: Lease,
  payments: RentPayment[],
  throughMonth: number,
  throughYear: number,
  siblingLeases?: Lease[]
): Array<{ month: number; year: number; amount: number }> {
  if (!lease.startDate || lease.needsReview) return [];
  if (lease.renewalStatus === 'pending' || lease.renewalStatus === 'rejected' || lease.renewalStatus === 'draft' || lease.renewalStatus === 'cancelled')
    return [];
  const leaseSet = siblingLeases || [lease];
  const from = yearMonthOf(lease.startDate);
  const through = throughYear * 12 + throughMonth;
  const settled = settleWithCarryForward(lease, payments, from, through, leaseSet);
  const out: Array<{ month: number; year: number; amount: number }> = [];
  for (const { ym, settlement } of settled) {
    if (settlement.balance > EPSILON) {
      const year = Math.floor((ym - 1) / 12);
      const month = ym - year * 12;
      out.push({ month, year, amount: round2(settlement.balance) });
    }
  }
  return out;
}

/** The minimum a per-lease-per-month row must carry to be grouped. */
export interface LeaseMonthLike {
  lease: Lease;
  month: number;
  settlement: MonthSettlement;
}

/** One lease collapsed into a single Rent Management row, keeping its months. */
export interface TenantRentGroup<R extends LeaseMonthLike> {
  lease: Lease;
  /** Every owed month for this lease in the viewed year, sorted ascending. */
  monthRows: R[];
  /** The current-month row, only when the viewed year is the current year. */
  thisMonth: R | null;
  /** Owed money from elapsed months BEFORE the current one (the "overdue" flag). */
  overdue: number;
  /** Overdue money, or this month unpaid/partial. Sorts to the top, undimmed. */
  needsAttention: boolean;
}

/**
 * Collapse per-lease-per-month rows into one group per lease for the Rent
 * Management list. Pure, so the this-month / overdue / attention logic is
 * unit-testable without rendering.
 *
 * - `thisMonth`: the current-month row, only when the viewed year IS the
 *   current year (a past or future year has no "this month" on this screen).
 * - `overdue`: sum of balances for ELAPSED months, excluding the current month
 *   (surfaced on its own, never double-counted) and any future month (not yet
 *   due). For a past year every month is elapsed; for a future year none is.
 * - `needsAttention`: has overdue money, or this month is unpaid/partial.
 *
 * Groups come back attention-first; the sort is stable, so the caller's
 * incoming order (property, then unit) is preserved within each bucket.
 */
export function groupLeaseMonthRows<R extends LeaseMonthLike>(
  rows: R[],
  selectedYear: number,
  todayYear: number,
  todayMonth: number
): TenantRentGroup<R>[] {
  const isCurrentYear = selectedYear === todayYear;
  const isPastYear = selectedYear < todayYear;
  const elapsedThrough = isPastYear ? 12 : isCurrentYear ? todayMonth : 0;
  const currentMonth = isCurrentYear ? todayMonth : 0;

  const groups = new Map<string, TenantRentGroup<R>>();
  for (const row of rows) {
    let g = groups.get(row.lease.id);
    if (!g) {
      g = { lease: row.lease, monthRows: [], thisMonth: null, overdue: 0, needsAttention: false };
      groups.set(row.lease.id, g);
    }
    g.monthRows.push(row);
  }

  for (const g of groups.values()) {
    g.monthRows.sort((a, b) => a.month - b.month);
    if (currentMonth) g.thisMonth = g.monthRows.find(r => r.month === currentMonth) ?? null;

    let overdue = 0;
    for (const r of g.monthRows) {
      if (r.month <= elapsedThrough && r.month !== currentMonth) {
        overdue = round2(overdue + r.settlement.balance);
      }
    }
    g.overdue = overdue;
    const thisMonthOwing = g.thisMonth ? g.thisMonth.settlement.status !== 'paid' : false;
    g.needsAttention = overdue > EPSILON || thisMonthOwing;
  }

  return [...groups.values()].sort((a, b) => Number(b.needsAttention) - Number(a.needsAttention));
}

/**
 * The months to show a tenant on the portal Payments page: every month the
 * lease owed from its start through the current month, PLUS any FUTURE month
 * that has already been paid (an advance payment), so paying ahead is visible.
 * A future month with no payment is not shown — it is not due yet. Returned
 * ascending; the caller reverses for newest-first display.
 */
export function rentMonthsToShow(
  lease: Lease,
  payments: RentPayment[],
  todayYear: number,
  todayMonth: number
): { month: number; year: number }[] {
  const nowYM = todayYear * 12 + todayMonth;
  const paidYMs = new Set(payments.map(p => p.year * 12 + p.month));
  const latestPaymentYM = payments.reduce((mx, p) => Math.max(mx, p.year * 12 + p.month), 0);
  const endYM = Math.max(nowYM, latestPaymentYM);
  const startYM = lease.startDate ? yearMonthOf(lease.startDate) : nowYM;

  const out: { month: number; year: number }[] = [];
  for (let ym = startYM; ym <= endYM; ym++) {
    const year = Math.floor((ym - 1) / 12);
    const month = ym - year * 12;
    if (leasesOwingMonth([lease], month, year).length === 0) continue;
    if (ym <= nowYM || paidYMs.has(ym)) out.push({ month, year });
  }
  return out;
}
