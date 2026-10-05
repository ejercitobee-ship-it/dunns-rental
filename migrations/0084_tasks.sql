-- Task & Project Management module
-- Supports both property-operations and general business/management tasks.

-- Projects: a collection of tasks with a larger objective.
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'planning',  -- planning, active, on_hold, completed, cancelled
  priority TEXT NOT NULL DEFAULT 'medium',  -- low, medium, high, urgent
  owner_id TEXT,                            -- user responsible
  start_date TEXT,
  due_date TEXT,
  property_id TEXT,                         -- optional link
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Tasks: the core work item.
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL DEFAULT 'other',   -- maintenance, tenant, leasing, finance, vendor, compliance, management, administrative, marketing, technology, projects, other
  status TEXT NOT NULL DEFAULT 'todo',      -- todo, in_progress, waiting, completed, cancelled
  priority TEXT NOT NULL DEFAULT 'medium',  -- low, medium, high, urgent
  waiting_for TEXT,                         -- free text: tenant, vendor, owner, payment, documents, etc.
  assigned_to TEXT,                         -- user_id
  created_by TEXT NOT NULL,
  due_date TEXT,
  due_time TEXT,
  start_date TEXT,
  estimated_minutes INTEGER,
  actual_minutes INTEGER,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  -- Optional relationships to existing records
  property_id TEXT,
  unit_id TEXT,
  tenant_id TEXT,
  vendor_id TEXT,                           -- handymen.id
  lease_id TEXT,
  maintenance_request_id TEXT,
  expense_id TEXT,
  inspection_id TEXT,
  -- Approval
  requires_approval INTEGER NOT NULL DEFAULT 0,
  approval_status TEXT DEFAULT 'not_required',  -- not_required, pending, approved, rejected
  approved_by TEXT,
  approved_at INTEGER,
  -- Recurrence
  is_recurring INTEGER NOT NULL DEFAULT 0,
  recurrence_rule TEXT,                     -- daily, weekly, monthly, quarterly, yearly
  recurrence_end_date TEXT,
  parent_task_id TEXT,                      -- source recurring task
  -- Completion
  completed_at INTEGER,
  completed_by TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_tasks_assigned ON tasks(assigned_to);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_property ON tasks(property_id);
CREATE INDEX IF NOT EXISTS idx_tasks_category ON tasks(category);
CREATE INDEX IF NOT EXISTS idx_tasks_created_by ON tasks(created_by);

-- Tags
CREATE TABLE IF NOT EXISTS task_tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  color TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Tag assignments (many-to-many)
CREATE TABLE IF NOT EXISTS task_tag_assignments (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES task_tags(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, tag_id)
);

-- Comments on tasks
CREATE TABLE IF NOT EXISTS task_comments (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  user_name TEXT,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_task_comments_task ON task_comments(task_id);

-- Attachments on tasks
CREATE TABLE IF NOT EXISTS task_attachments (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  drive_file_id TEXT NOT NULL,
  content_type TEXT,
  size INTEGER,
  uploaded_by TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Activity / status history on tasks
CREATE TABLE IF NOT EXISTS task_activity (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  action TEXT NOT NULL,   -- created, status_changed, assigned, reassigned, priority_changed, due_date_changed, comment_added, attachment_added, completed, approval_requested, approved, rejected, category_changed
  from_value TEXT,
  to_value TEXT,
  user_id TEXT NOT NULL,
  user_name TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_task_activity_task ON task_activity(task_id);

-- Task templates
CREATE TABLE IF NOT EXISTS task_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Template items (the task steps)
CREATE TABLE IF NOT EXISTS task_template_items (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL REFERENCES task_templates(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  category TEXT,
  priority TEXT DEFAULT 'medium',
  sort_order INTEGER NOT NULL DEFAULT 0,
  estimated_minutes INTEGER
);

-- Grant tasks permissions to super_admin role
UPDATE roles
SET permissions = json_insert(
  CASE WHEN json_valid(permissions) THEN permissions ELSE '[]' END,
  '$[#]', 'tasks_view',
  '$[#]', 'tasks_create',
  '$[#]', 'tasks_edit',
  '$[#]', 'tasks_delete',
  '$[#]', 'tasks_assign',
  '$[#]', 'projects_manage'
)
WHERE id = 'super_admin';

-- Grant tasks permissions to admin role
UPDATE roles
SET permissions = json_insert(
  CASE WHEN json_valid(permissions) THEN permissions ELSE '[]' END,
  '$[#]', 'tasks_view',
  '$[#]', 'tasks_create',
  '$[#]', 'tasks_edit',
  '$[#]', 'tasks_assign',
  '$[#]', 'projects_manage'
)
WHERE id = 'admin';

-- Grant tasks permissions to manager role
UPDATE roles
SET permissions = json_insert(
  CASE WHEN json_valid(permissions) THEN permissions ELSE '[]' END,
  '$[#]', 'tasks_view',
  '$[#]', 'tasks_create',
  '$[#]', 'tasks_edit',
  '$[#]', 'tasks_assign'
)
WHERE id = 'manager';

-- Grant view to viewer/accountant
UPDATE roles
SET permissions = json_insert(
  CASE WHEN json_valid(permissions) THEN permissions ELSE '[]' END,
  '$[#]', 'tasks_view'
)
WHERE id IN ('viewer', 'accountant');
