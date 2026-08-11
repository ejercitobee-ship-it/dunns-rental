-- Property inspection reports: move-in, move-out, and periodic.
-- Room-by-room condition checklists with notes and photo references.

CREATE TABLE IF NOT EXISTS inspections (
  id               TEXT PRIMARY KEY,
  property_id      TEXT,
  unit_id          TEXT,
  lease_id         TEXT,
  tenant_id        TEXT,
  type             TEXT NOT NULL DEFAULT 'move_in',  -- move_in | move_out | periodic
  inspection_date  TEXT NOT NULL,
  inspector_name   TEXT,
  status           TEXT NOT NULL DEFAULT 'draft',    -- draft | completed
  notes            TEXT,
  drive_file_id    TEXT,    -- generated PDF stored in Drive
  created_at       INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at       INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS inspection_items (
  id               TEXT PRIMARY KEY,
  inspection_id    TEXT NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
  room             TEXT NOT NULL,      -- e.g. living_room, kitchen, bedroom_1, bathroom_1
  item             TEXT NOT NULL,      -- e.g. walls, ceiling, floor, windows, doors, fixtures
  condition        TEXT NOT NULL DEFAULT 'good',  -- excellent | good | fair | poor | damaged | na
  notes            TEXT,
  photo_drive_id   TEXT,
  created_at       INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_inspections_unit ON inspections(unit_id);
CREATE INDEX IF NOT EXISTS idx_inspections_lease ON inspections(lease_id);
CREATE INDEX IF NOT EXISTS idx_inspections_type ON inspections(type);
CREATE INDEX IF NOT EXISTS idx_inspection_items_inspection ON inspection_items(inspection_id);
