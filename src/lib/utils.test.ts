import { describe, it, expect } from 'vitest';
import { formatDate } from './utils';

describe('formatDate', () => {
  it('renders a date-only YYYY-MM-DD as that same calendar day, with no UTC day shift', () => {
    // The bug this guards: new Date('2026-07-01') is UTC midnight, which renders
    // as "Jun 30" for anyone behind UTC (the owner is in America/Chicago).
    // Local-parts parsing keeps the calendar day in every timezone.
    expect(formatDate('2026-07-01')).toBe('Jul 1, 2026');
    expect(formatDate('2026-01-01')).toBe('Jan 1, 2026');
    expect(formatDate('2025-12-31')).toBe('Dec 31, 2025');
  });

  it('still formats a full ISO timestamp', () => {
    // A full timestamp is an unambiguous instant; noon UTC lands on the same
    // calendar day across the Americas and Europe, so this is runner-stable.
    expect(formatDate('2026-07-01T12:00:00.000Z')).toBe('Jul 1, 2026');
  });
});
