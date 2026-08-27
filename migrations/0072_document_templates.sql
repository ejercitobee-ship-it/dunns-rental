-- Central document templates library. The office uploads standard documents
-- (lease agreement, application form, rules & regulations, etc.) once and
-- reuses them for every prospective tenant.
CREATE TABLE IF NOT EXISTS document_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'other'
    CHECK (category IN ('lease', 'application', 'rules', 'addendum', 'other')),
  description TEXT,
  drive_file_id TEXT NOT NULL,
  content_type TEXT,
  size INTEGER,
  uploaded_by TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
