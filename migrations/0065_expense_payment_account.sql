-- Last 3-4 digits of the bank/card account used to pay an expense.
-- Helps identify the payment source when reviewing transactions.
ALTER TABLE expenses ADD COLUMN payment_account TEXT;
