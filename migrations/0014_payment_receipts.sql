-- Link a rent payment to the receipt document generated when it was marked
-- paid. Nullable and FK-less (matches documents.tenant_id): it points at the
-- documents row for the receipt so the UI knows one exists and can link to it.
ALTER TABLE rent_payments ADD COLUMN receipt_document_id TEXT;
