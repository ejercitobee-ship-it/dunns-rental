-- Backing table for the generic fixed-window rate limiter
-- (functions/lib/rate-limit.ts), used to cap expensive endpoints such as the
-- AI assistant and the Stripe setup/pay-rent flows. The limiter is fail-open,
-- so this table is a performance/abuse guard only, never an auth control.
CREATE TABLE IF NOT EXISTS rate_limits (
  key          TEXT PRIMARY KEY,
  count        INTEGER NOT NULL DEFAULT 0,
  window_start INTEGER NOT NULL
);
