-- Idempotency table for Stripe webhook events
CREATE TABLE IF NOT EXISTS processed_stripe_events (
  event_id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);

-- Store tenant IP and user agent when they enable autopay (for ACH mandate)
ALTER TABLE user ADD COLUMN autopay_ip TEXT;
ALTER TABLE user ADD COLUMN autopay_user_agent TEXT;
