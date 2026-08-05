-- Expense import staging: uploaded files are parsed into staging rows,
-- validated, reviewed, and only merged to the live expenses table on approval.

CREATE TABLE IF NOT EXISTS expense_imports (
  id TEXT PRIMARY KEY,
  file_name TEXT NOT NULL,
  file_drive_id TEXT,           -- original file stored in Drive for reference
  uploaded_by TEXT NOT NULL,
  uploaded_by_name TEXT,
  uploaded_at INTEGER NOT NULL DEFAULT (unixepoch()),
  status TEXT NOT NULL DEFAULT 'staged',  -- staged | validated | merged | rolled_back
  total_rows INTEGER NOT NULL DEFAULT 0,
  valid_rows INTEGER NOT NULL DEFAULT 0,
  error_rows INTEGER NOT NULL DEFAULT 0,
  duplicate_rows INTEGER NOT NULL DEFAULT 0,
  merged_rows INTEGER NOT NULL DEFAULT 0,
  merged_at INTEGER,
  merged_by TEXT,
  merged_by_name TEXT,
  rolled_back_at INTEGER,
  rolled_back_by TEXT,
  rolled_back_by_name TEXT,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS expense_import_rows (
  id TEXT PRIMARY KEY,
  import_id TEXT NOT NULL REFERENCES expense_imports(id),
  row_number INTEGER NOT NULL,
  -- Original imported values preserved as JSON
  original_data TEXT,
  -- Mapped / cleaned values
  property_id TEXT,
  property_name TEXT,           -- display hint from the import (resolved to id)
  unit_id TEXT,
  unit_name TEXT,
  category TEXT,
  amount REAL,
  date TEXT,
  description TEXT,
  vendor TEXT,
  notes TEXT,
  tax_category TEXT,
  tax_deductible INTEGER DEFAULT 1,
  is_recurring INTEGER DEFAULT 0,
  recurring_frequency TEXT,
  interest_amount REAL,
  -- Validation
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | valid | error | duplicate | skipped
  errors TEXT,                  -- JSON array of validation error strings
  -- Merge tracking
  created_expense_id TEXT,      -- points to the live expense after merge
  edited INTEGER DEFAULT 0,
  edited_by TEXT,
  edited_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_eir_import_id ON expense_import_rows(import_id);
CREATE INDEX IF NOT EXISTS idx_eir_status ON expense_import_rows(status);

-- Track which import created a live expense so rollback can target them.
ALTER TABLE expenses ADD COLUMN import_id TEXT;
ALTER TABLE expenses ADD COLUMN import_row_id TEXT;
