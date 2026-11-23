import { type Env } from './session';

// Generic fixed-window rate limiter backed by a small D1 table.
//
// It is FAIL-OPEN by design: any error, including the rate_limits table not
// existing yet (before migration 0097 is applied), allows the request. Adding
// this can therefore never lock users out of an otherwise working deploy. It is
// a cost and abuse guard for expensive endpoints (AI chat, Stripe setup/pay),
// not a security boundary; authorization is enforced separately by the guards.

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the window resets, when not allowed. */
  retryAfter: number;
}

export async function checkRateLimit(
  env: Env,
  key: string,
  max: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  const now = Math.floor(Date.now() / 1000);
  try {
    const row = await env.DB.prepare(
      'SELECT count, window_start FROM rate_limits WHERE key = ?'
    ).bind(key).first<{ count: number; window_start: number }>();

    // Fresh window (no row, or the previous window fully elapsed).
    if (!row || now - row.window_start >= windowSeconds) {
      await env.DB.prepare(
        `INSERT INTO rate_limits (key, count, window_start) VALUES (?, 1, ?)
         ON CONFLICT(key) DO UPDATE SET count = 1, window_start = ?`
      ).bind(key, now, now).run();
      return { allowed: true, retryAfter: 0 };
    }

    if (row.count >= max) {
      return { allowed: false, retryAfter: Math.max(1, row.window_start + windowSeconds - now) };
    }

    await env.DB.prepare('UPDATE rate_limits SET count = count + 1 WHERE key = ?')
      .bind(key).run();
    return { allowed: true, retryAfter: 0 };
  } catch {
    // Fail open: never block a request because the limiter itself failed.
    return { allowed: true, retryAfter: 0 };
  }
}
