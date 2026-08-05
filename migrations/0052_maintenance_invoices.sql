-- Maintenance invoice workflow: after admin approves completed work, the
-- handyman uploads an invoice. Admin reviews and approves the invoice, which
-- auto-creates the expense. This replaces the direct expense-on-approve flow
-- for jobs that go through the invoice path.

-- Invoice metadata columns on maintenance_requests.
ALTER TABLE maintenance_requests ADD COLUMN invoice_number TEXT;
ALTER TABLE maintenance_requests ADD COLUMN invoice_date TEXT;
ALTER TABLE maintenance_requests ADD COLUMN invoice_labor_amount REAL;
ALTER TABLE maintenance_requests ADD COLUMN invoice_material_amount REAL;
ALTER TABLE maintenance_requests ADD COLUMN invoice_total_amount REAL;
ALTER TABLE maintenance_requests ADD COLUMN invoice_notes TEXT;
-- JSON array of { id, name, contentType } objects: the Drive file IDs for the
-- uploaded invoice PDF + any receipt images.
ALTER TABLE maintenance_requests ADD COLUMN invoice_drive_ids TEXT;
ALTER TABLE maintenance_requests ADD COLUMN invoice_submitted_at TEXT;
ALTER TABLE maintenance_requests ADD COLUMN invoice_approved_at TEXT;
ALTER TABLE maintenance_requests ADD COLUMN invoice_approved_by TEXT;
-- Set when admin rejects or requests a revision; cleared on re-submit.
ALTER TABLE maintenance_requests ADD COLUMN invoice_rejection_reason TEXT;

-- Audit trail: every maintenance status transition is logged.
CREATE TABLE IF NOT EXISTS maintenance_status_log (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL,
  changed_by_id TEXT,
  changed_by_name TEXT,
  notes TEXT,
  created_at INTEGER DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_maint_status_log_request ON maintenance_status_log(request_id);
CREATE INDEX IF NOT EXISTS idx_maint_status_log_time ON maintenance_status_log(created_at DESC);
