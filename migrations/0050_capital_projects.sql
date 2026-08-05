-- Capital Expense Projects: group multiple expenses into one capital improvement.
CREATE TABLE IF NOT EXISTS capital_projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  property_id TEXT NOT NULL,
  unit_id TEXT,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'in_progress',  -- in_progress | completed | cancelled
  start_date TEXT,  -- YYYY-MM-DD
  completion_date TEXT,
  budget REAL,
  drive_folder_id TEXT,
  created_by TEXT,
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch())
);

-- Link expenses to a capital project (nullable: most expenses aren't in a project).
ALTER TABLE expenses ADD COLUMN capital_project_id TEXT;

-- Index for fast lookup of all expenses in a project.
CREATE INDEX IF NOT EXISTS idx_expenses_capital_project ON expenses(capital_project_id);
CREATE INDEX IF NOT EXISTS idx_capital_projects_property ON capital_projects(property_id);
