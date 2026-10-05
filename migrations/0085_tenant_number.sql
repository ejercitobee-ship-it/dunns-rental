-- Add a human-readable tenant number (e.g. MHD-0001) to the tenants table.
-- Co-tenants on the same active lease share the same number.
ALTER TABLE tenants ADD COLUMN tenant_number TEXT;

-- Pass 1: tenants with an active lease. Each distinct active lease gets a
-- sequential number; every tenant on that lease receives the same number.
UPDATE tenants SET tenant_number = (
  SELECT 'MHD-' || SUBSTR('0000' || lease_seq, -4)
  FROM (
    SELECT lt_inner.lease_id,
           ROW_NUMBER() OVER (ORDER BY MIN(t_inner.created_at), lt_inner.lease_id) AS lease_seq
      FROM lease_tenants lt_inner
      JOIN leases l_inner ON l_inner.id = lt_inner.lease_id AND l_inner.status != 'ended'
      JOIN tenants t_inner ON t_inner.id = lt_inner.tenant_id
     GROUP BY lt_inner.lease_id
  ) lease_nums
  JOIN lease_tenants lt2 ON lt2.lease_id = lease_nums.lease_id
  WHERE lt2.tenant_id = tenants.id
  LIMIT 1
)
WHERE tenants.id IN (
  SELECT lt3.tenant_id
    FROM lease_tenants lt3
    JOIN leases l3 ON l3.id = lt3.lease_id AND l3.status != 'ended'
);

-- Pass 2: tenants without an active lease get individual numbers continuing
-- after the last lease-based number.
UPDATE tenants SET tenant_number = (
  SELECT 'MHD-' || SUBSTR('0000' || (mx + rn), -4)
  FROM (
    SELECT id, ROW_NUMBER() OVER (ORDER BY created_at, id) AS rn
      FROM tenants WHERE tenant_number IS NULL
  ) un
  CROSS JOIN (
    SELECT COALESCE(MAX(CAST(SUBSTR(tenant_number, 5) AS INTEGER)), 0) AS mx
      FROM tenants WHERE tenant_number IS NOT NULL
  )
  WHERE un.id = tenants.id
)
WHERE tenant_number IS NULL;

-- Non-unique: co-tenants share a number.
CREATE INDEX IF NOT EXISTS idx_tenants_tenant_number ON tenants(tenant_number);
