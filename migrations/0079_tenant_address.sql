-- Tenant mailing / personal address (separate from lease property address).
ALTER TABLE tenants ADD COLUMN address_line1 TEXT;
ALTER TABLE tenants ADD COLUMN address_line2 TEXT;
ALTER TABLE tenants ADD COLUMN city TEXT;
ALTER TABLE tenants ADD COLUMN state TEXT;
ALTER TABLE tenants ADD COLUMN zip TEXT;
