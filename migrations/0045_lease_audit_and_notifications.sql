-- Lease change audit trail: every modification to a lease is recorded here.
CREATE TABLE IF NOT EXISTS lease_audit_log (
  id TEXT PRIMARY KEY,
  lease_id TEXT NOT NULL REFERENCES leases(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  changed_by TEXT,
  changed_by_name TEXT,
  previous_data TEXT,
  new_data TEXT,
  notes TEXT,
  created_at INTEGER DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_lease_audit_lease ON lease_audit_log(lease_id);
CREATE INDEX IF NOT EXISTS idx_lease_audit_created ON lease_audit_log(created_at DESC);

-- Lease notification history: every email sent about a lease status change.
CREATE TABLE IF NOT EXISTS lease_notifications (
  id TEXT PRIMARY KEY,
  lease_id TEXT NOT NULL REFERENCES leases(id) ON DELETE CASCADE,
  tenant_id TEXT REFERENCES tenants(id) ON DELETE SET NULL,
  tenant_email TEXT,
  notification_type TEXT NOT NULL,
  subject TEXT,
  status TEXT NOT NULL DEFAULT 'sent',
  sent_by TEXT,
  created_at INTEGER DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_lease_notif_lease ON lease_notifications(lease_id);

-- Renewal approval workflow: add a renewal_status column to leases.
-- 'approved' = active (backwards compatible), 'pending' = awaiting approval,
-- 'rejected' = declined, 'draft' = not yet submitted.
ALTER TABLE leases ADD COLUMN renewal_status TEXT DEFAULT 'approved';

-- Management expenses folder ID (business-level, not property-specific).
-- Stored in app_settings via key 'google_mgmt_expenses_folder_id'.
