-- Store the Stripe payment method type for autopay (us_bank_account or card)
-- so the cron knows which fee to apply and which payment_method_types to use.
ALTER TABLE user ADD COLUMN autopay_method_type TEXT DEFAULT 'us_bank_account';
