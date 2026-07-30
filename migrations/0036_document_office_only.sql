-- Mark a document as office-only so it never appears in the tenant portal.
-- Used for proof-of-payment screenshots the office uploads: they are the
-- landlord's record, not something the tenant should see.
ALTER TABLE documents ADD COLUMN office_only INTEGER NOT NULL DEFAULT 0;
