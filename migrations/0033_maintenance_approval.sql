-- Handyman self-reported work + admin approval.
-- needs_approval: 1 when a handyman logged work they did that an admin has not
--   approved yet. It stays out of Finances until approved.
-- approved_at: the day an admin approved the job (and its cost), which is when
--   the expense is written against the property/unit.
-- reported_cost: the cost the handyman proposed, kept alongside the approved
--   `cost` so "they said X, I approved Y" is visible.
ALTER TABLE maintenance_requests ADD COLUMN needs_approval INTEGER NOT NULL DEFAULT 0;
ALTER TABLE maintenance_requests ADD COLUMN approved_at TEXT;
ALTER TABLE maintenance_requests ADD COLUMN reported_cost REAL;
