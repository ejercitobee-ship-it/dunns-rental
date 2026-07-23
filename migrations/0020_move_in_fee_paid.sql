-- Whether the tenant's move-in fee (the amount stored in security_deposit) has
-- been paid. Default 1 (paid) so every existing lease is treated as settled and
-- no tenant is suddenly shown as owing a fee they already handled.
ALTER TABLE leases ADD COLUMN move_in_fee_paid INTEGER DEFAULT 1;
