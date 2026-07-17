import { describe, it, expect } from 'vitest';
import { realtorAccessEndsOn, realtorWindowOpen } from './portal';

describe('realtorAccessEndsOn', () => {
  it('ends 30 days after move in when the link came first', () => {
    expect(realtorAccessEndsOn('2026-03-01', '2026-02-20')).toBe('2026-03-31');
  });

  // Belle links realtors after the fact, including for tenants who moved in
  // long ago. Without the "whichever is later" half of the rule, linking them
  // would grant nothing at all.
  it('ends 30 days after the link when the link came later', () => {
    expect(realtorAccessEndsOn('2026-01-01', '2026-06-10')).toBe('2026-07-10');
  });

  it('crosses a month boundary correctly', () => {
    expect(realtorAccessEndsOn('2026-01-20', '2026-01-01')).toBe('2026-02-19');
  });

  it('crosses a year boundary correctly', () => {
    expect(realtorAccessEndsOn('2026-12-20', '2026-12-01')).toBe('2027-01-19');
  });
});

describe('realtorWindowOpen', () => {
  it('is open on the move in day', () => {
    expect(realtorWindowOpen('2026-03-01', '2026-03-01', '2026-03-01')).toBe(true);
  });

  it('is open on the last day of the window', () => {
    expect(realtorWindowOpen('2026-03-01', '2026-03-01', '2026-03-31')).toBe(true);
  });

  it('is closed the day after the window', () => {
    expect(realtorWindowOpen('2026-03-01', '2026-03-01', '2026-04-01')).toBe(false);
  });

  it('is open for a late link even though move in was long ago', () => {
    expect(realtorWindowOpen('2026-01-01', '2026-06-10', '2026-07-01')).toBe(true);
  });

  it('is closed once a late link has itself aged out', () => {
    expect(realtorWindowOpen('2026-01-01', '2026-06-10', '2026-07-11')).toBe(false);
  });

  // A lease with no start date cannot anchor a move in, so the link date is
  // the only honest anchor.
  it('falls back to the link date when the lease has no start date', () => {
    expect(realtorWindowOpen(undefined, '2026-06-10', '2026-07-01')).toBe(true);
    expect(realtorWindowOpen(undefined, '2026-06-10', '2026-07-11')).toBe(false);
  });
});
