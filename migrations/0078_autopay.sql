-- Autopay: let tenants opt in to automatic rent collection on the due date.
ALTER TABLE user ADD COLUMN autopay_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE user ADD COLUMN autopay_payment_method_id TEXT;
