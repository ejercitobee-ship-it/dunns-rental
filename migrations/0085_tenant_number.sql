-- Add a human-readable tenant number (e.g. MHD-0001) to the tenants table.
ALTER TABLE tenants ADD COLUMN tenant_number TEXT;

-- Backfill existing tenants in creation order using a CTE.
UPDATE tenants
SET tenant_number = (
  SELECT 'MHD-' || SUBSTR('0000' || rn, -4)
  FROM (
    SELECT id, ROW_NUMBER() OVER (ORDER BY created_at, id) AS rn
    FROM tenants
  ) numbered
  WHERE numbered.id = tenants.id
);

-- Ensure uniqueness going forward.
CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_tenant_number ON tenants(tenant_number);
