-- In-app notification center for management users.
-- Separate from the tenant-facing push `notifications` table (0019).
CREATE TABLE IF NOT EXISTS mgmt_notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  type TEXT NOT NULL,          -- task, project, maintenance, tenant, lease, payment, expense, vendor, inspection, approval, system
  category TEXT NOT NULL,      -- e.g. task_assigned, maintenance_new, payment_received
  priority TEXT NOT NULL DEFAULT 'normal', -- informational, normal, important, urgent
  title TEXT NOT NULL,
  message TEXT,
  entity_type TEXT,            -- tasks, maintenance_requests, tenants, leases, etc.
  entity_id TEXT,
  route TEXT,                  -- front-end route to navigate to, e.g. /tasks or /maintenance
  is_read INTEGER NOT NULL DEFAULT 0,
  read_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_mgmt_notif_user ON mgmt_notifications(user_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mgmt_notif_user_created ON mgmt_notifications(user_id, created_at DESC);
