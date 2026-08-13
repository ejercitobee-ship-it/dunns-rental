-- Rent credits: a credit reduces what a tenant owes for a month without
-- recording real income. Stored in the same rent_payments table so the
-- settlement math (settleMonth) counts them automatically.
--
-- type = 'payment' (default, real money in) or 'credit' (balance reduction).
-- credit_reason = why the credit was given (proration, maintenance, other).

ALTER TABLE rent_payments ADD COLUMN type TEXT NOT NULL DEFAULT 'payment';
ALTER TABLE rent_payments ADD COLUMN credit_reason TEXT;
