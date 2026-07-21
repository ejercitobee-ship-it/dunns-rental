-- Maintenance portal: a roster of handymen (a new portal role) take
-- trade-matched jobs that tenants report, confirm a time from the tenant's
-- availability, work them, and the admin records payment. Extends the existing
-- maintenance_requests table and adds the handyman roster.

-- The handyman portal role. Empty permissions like the other portal roles: it
-- reaches ONLY the portal endpoints, each scoped to the caller. is_system = 1
-- so it cannot be deleted from Settings.
INSERT OR IGNORE INTO roles (id, name, description, permissions, is_system) VALUES
  ('handyman', 'Handyman', 'Portal only. Sees maintenance jobs matching their trades.', '[]', 1);

-- The roster Belle manages. One row per handyman, linked to their portal login.
-- trades is a JSON array of category slugs (plumbing, electrical, hvac,
-- appliance, carpentry, general, other); a new request is offered to handymen
-- whose trades contain the request's category.
CREATE TABLE IF NOT EXISTS handymen (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES user(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  trades TEXT NOT NULL DEFAULT '[]',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch())
);

-- One login is at most one handyman, mirroring the tenants.user_id rule.
CREATE UNIQUE INDEX IF NOT EXISTS idx_handymen_user_id ON handymen(user_id);

-- Fields the portal workflow needs on each request.
--   assigned_handyman_id  the handyman who claimed or was assigned the job
--   scheduled_for         the confirmed appointment (local 'YYYY-MM-DD HH:MM')
--   availability          JSON array of tenant windows [{date,start,end}, ...]
--   paid_at              local date the admin recorded paying the handyman
--   created_by            'tenant' or 'admin', who opened the request
ALTER TABLE maintenance_requests ADD COLUMN assigned_handyman_id TEXT REFERENCES handymen(id) ON DELETE SET NULL;
ALTER TABLE maintenance_requests ADD COLUMN scheduled_for TEXT;
ALTER TABLE maintenance_requests ADD COLUMN availability TEXT;
ALTER TABLE maintenance_requests ADD COLUMN paid_at TEXT;
ALTER TABLE maintenance_requests ADD COLUMN created_by TEXT;

CREATE INDEX IF NOT EXISTS idx_maintenance_assigned ON maintenance_requests(assigned_handyman_id);

-- Remap the old status vocabulary (open/in_progress/resolved/cancelled) onto the
-- new lifecycle. in_progress and cancelled carry over unchanged.
UPDATE maintenance_requests SET status = 'submitted' WHERE status = 'open';
UPDATE maintenance_requests SET status = 'paid' WHERE status = 'resolved';
