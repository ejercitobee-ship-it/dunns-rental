import { type Env } from './session';

// After this many failed sign in attempts from one IP inside the window, the IP
// is locked out for the cooling-off period. Tuned to stop automated guessing
// while leaving generous room for a real person mistyping their password.
export const THROTTLE_MAX = 8;
export const THROTTLE_WINDOW = 15 * 60; // seconds a failure "counts" for
export const THROTTLE_LOCK = 15 * 60; // seconds an IP stays locked

export interface ThrottleRow {
  fail_count: number;
  first_fail_at: number;
  locked_until: number | null;
}

/** The lock expiry if this IP is currently locked, else null. Pure. */
export function lockedUntil(row: ThrottleRow | null, now: number): number | null {
  return row?.locked_until && row.locked_until > now ? row.locked_until : null;
}

/**
 * The throttle row after ONE more failed attempt. A window that has fully
 * elapsed starts fresh; otherwise the count climbs and, at the limit, stamps a
 * lock. Pure, so the decision is unit-testable without a database.
 */
export function afterFailure(row: ThrottleRow | null, now: number): ThrottleRow {
  if (!row || now - row.first_fail_at > THROTTLE_WINDOW) {
    return { fail_count: 1, first_fail_at: now, locked_until: null };
  }
  const fail_count = row.fail_count + 1;
  return {
    fail_count,
    first_fail_at: row.first_fail_at,
    locked_until: fail_count >= THROTTLE_MAX ? now + THROTTLE_LOCK : null,
  };
}

async function readRow(env: Env, ip: string): Promise<ThrottleRow | null> {
  return env.DB.prepare(
    'SELECT fail_count, first_fail_at, locked_until FROM login_throttle WHERE ip = ?'
  ).bind(ip).first<ThrottleRow>();
}

/** If the IP is locked, the unix-seconds instant it unlocks; else null. */
export async function throttleLockedUntil(env: Env, ip: string | null): Promise<number | null> {
  if (!ip) return null;
  return lockedUntil(await readRow(env, ip), Math.floor(Date.now() / 1000));
}

/** Record one failed sign in from this IP, opening or extending a lock. */
export async function recordLoginFailure(env: Env, ip: string | null): Promise<void> {
  if (!ip) return;
  const now = Math.floor(Date.now() / 1000);
  const next = afterFailure(await readRow(env, ip), now);
  await env.DB.prepare(
    `INSERT INTO login_throttle (ip, fail_count, first_fail_at, locked_until)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(ip) DO UPDATE SET
       fail_count = excluded.fail_count,
       first_fail_at = excluded.first_fail_at,
       locked_until = excluded.locked_until`
  ).bind(ip, next.fail_count, next.first_fail_at, next.locked_until).run();
}

/** Clear an IP's failures after a successful sign in. */
export async function clearLoginThrottle(env: Env, ip: string | null): Promise<void> {
  if (!ip) return;
  await env.DB.prepare('DELETE FROM login_throttle WHERE ip = ?').bind(ip).run();
}
