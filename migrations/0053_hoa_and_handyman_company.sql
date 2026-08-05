-- Add HOA as a recognised expense category (the column is a free-text string,
-- so existing rows don't need migration — only the frontend controls what
-- values are offered). This migration adds the company_name column to the
-- handymen table for reporting purposes.

ALTER TABLE handymen ADD COLUMN company_name TEXT;
