import { describe, it, expect } from 'vitest';
import { afterFailure, lockedUntil, THROTTLE_MAX, THROTTLE_WINDOW, THROTTLE_LOCK, type ThrottleRow } from './throttle';

const NOW = 1_000_000;

describe('lockedUntil', () => {
  it('is null with no row', () => {
    expect(lockedUntil(null, NOW)).toBeNull();
  });
  it('is null when the lock has passed', () => {
    const row: ThrottleRow = { fail_count: THROTTLE_MAX, first_fail_at: NOW - 1000, locked_until: NOW - 1 };
    expect(lockedUntil(row, NOW)).toBeNull();
  });
  it('returns the instant when still locked', () => {
    const row: ThrottleRow = { fail_count: THROTTLE_MAX, first_fail_at: NOW, locked_until: NOW + 500 };
    expect(lockedUntil(row, NOW)).toBe(NOW + 500);
  });
});

describe('afterFailure', () => {
  it('opens a fresh window on the first failure', () => {
    expect(afterFailure(null, NOW)).toEqual({ fail_count: 1, first_fail_at: NOW, locked_until: null });
  });

  it('climbs within the window without locking below the limit', () => {
    const row: ThrottleRow = { fail_count: 3, first_fail_at: NOW, locked_until: null };
    expect(afterFailure(row, NOW + 60)).toEqual({ fail_count: 4, first_fail_at: NOW, locked_until: null });
  });

  it('locks exactly at the limit', () => {
    const row: ThrottleRow = { fail_count: THROTTLE_MAX - 1, first_fail_at: NOW, locked_until: null };
    const next = afterFailure(row, NOW + 60);
    expect(next.fail_count).toBe(THROTTLE_MAX);
    expect(next.locked_until).toBe(NOW + 60 + THROTTLE_LOCK);
  });

  it('resets once the window has fully elapsed', () => {
    const row: ThrottleRow = { fail_count: THROTTLE_MAX, first_fail_at: NOW, locked_until: NOW + THROTTLE_LOCK };
    const later = NOW + THROTTLE_WINDOW + 1;
    expect(afterFailure(row, later)).toEqual({ fail_count: 1, first_fail_at: later, locked_until: null });
  });
});
