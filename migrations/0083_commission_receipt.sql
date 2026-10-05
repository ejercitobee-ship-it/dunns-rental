-- Link a payment-confirmation document to an expense (used by commission payments).
ALTER TABLE expenses ADD COLUMN receipt_document_id TEXT;
