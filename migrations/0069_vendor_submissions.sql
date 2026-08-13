-- No-login vendor invoice submissions: a secure token link is emailed to a
-- vendor (handyman, contractor, etc.) who fills out a form with their company
-- info, the property/unit they worked on, cost, and payment preference. The
-- submission lands in the admin's queue for approval. Status emails are sent
-- on received/approved/paid.

CREATE TABLE IF NOT EXISTS vendor_submissions (
  id TEXT PRIMARY KEY,
  -- The secure token the vendor uses to load and submit the form (no login).
  token TEXT NOT NULL UNIQUE,
  -- Optional link back to the maintenance job this invoice is for.
  maintenance_request_id TEXT REFERENCES maintenance_requests(id) ON DELETE SET NULL,
  -- Vendor identity (filled in by the vendor on the form).
  vendor_name TEXT NOT NULL DEFAULT '',
  company_name TEXT NOT NULL DEFAULT '',
  vendor_email TEXT NOT NULL DEFAULT '',
  vendor_phone TEXT,
  -- What they did and where.
  property_id TEXT REFERENCES properties(id) ON DELETE SET NULL,
  unit_id TEXT REFERENCES units(id) ON DELETE SET NULL,
  work_description TEXT,
  -- Money.
  amount REAL,
  payment_method TEXT,              -- check, zelle, venmo, cash, other
  -- Lifecycle: draft (link sent, not yet submitted), submitted, approved, paid.
  status TEXT NOT NULL DEFAULT 'draft',
  -- Admin review.
  approved_by TEXT,
  approved_at TEXT,
  paid_at TEXT,
  rejection_reason TEXT,
  admin_notes TEXT,
  -- The expense row auto-created on approval.
  expense_id TEXT,
  -- Who sent the link and when.
  created_by TEXT,
  created_at INTEGER DEFAULT (unixepoch()),
  submitted_at INTEGER,
  updated_at INTEGER DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_vendor_sub_token ON vendor_submissions(token);
CREATE INDEX IF NOT EXISTS idx_vendor_sub_status ON vendor_submissions(status);
CREATE INDEX IF NOT EXISTS idx_vendor_sub_maint ON vendor_submissions(maintenance_request_id);
