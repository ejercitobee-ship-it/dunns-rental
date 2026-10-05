-- Track the receipt document generated when a vendor is paid.
ALTER TABLE maintenance_requests ADD COLUMN receipt_document_id TEXT;
