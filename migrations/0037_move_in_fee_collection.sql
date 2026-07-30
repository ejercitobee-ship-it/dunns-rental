-- Track the move-in fee as a collectible obligation with a receipt, without
-- disturbing the month-based rent ledger. The fee AMOUNT already lives in
-- leases.security_deposit (labelled "Move-In Fee") and leases.move_in_fee_paid
-- is the paid flag; these add the payment details + its receipt.
ALTER TABLE leases ADD COLUMN move_in_fee_paid_date TEXT;
ALTER TABLE leases ADD COLUMN move_in_fee_method TEXT;
ALTER TABLE leases ADD COLUMN move_in_fee_receipt_document_id TEXT;
