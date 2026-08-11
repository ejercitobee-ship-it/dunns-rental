-- Tenant notices and letters: late rent, lease violation, non-renewal, rent increase.
-- Each notice is generated from a template, auto-filled with tenant/property data,
-- and optionally stored as a PDF in Drive.

CREATE TABLE IF NOT EXISTS notices (
  id               TEXT PRIMARY KEY,
  property_id      TEXT,
  unit_id          TEXT,
  lease_id         TEXT,
  tenant_id        TEXT,
  type             TEXT NOT NULL,  -- late_rent | violation | non_renewal | rent_increase | custom
  title            TEXT NOT NULL,
  body             TEXT NOT NULL,  -- the rendered notice text
  notice_date      TEXT NOT NULL,
  delivery_method  TEXT,           -- hand_delivered | posted | email | certified_mail
  delivered_at     TEXT,
  status           TEXT NOT NULL DEFAULT 'draft',  -- draft | sent | acknowledged
  drive_file_id    TEXT,           -- generated PDF stored in Drive
  created_by       TEXT,
  created_at       INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at       INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_notices_tenant ON notices(tenant_id);
CREATE INDEX IF NOT EXISTS idx_notices_lease ON notices(lease_id);
CREATE INDEX IF NOT EXISTS idx_notices_type ON notices(type);
