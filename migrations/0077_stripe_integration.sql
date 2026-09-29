-- Stripe integration: customer IDs on users, payment intent tracking on rent_payments
ALTER TABLE user ADD COLUMN stripe_customer_id TEXT;
ALTER TABLE rent_payments ADD COLUMN stripe_payment_intent_id TEXT;
