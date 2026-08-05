-- Enrich the activity_log table with module context, human descriptions,
-- linked records (property/unit/tenant), and before/after change tracking.

ALTER TABLE activity_log ADD COLUMN module TEXT;
ALTER TABLE activity_log ADD COLUMN description TEXT;
ALTER TABLE activity_log ADD COLUMN property_id TEXT;
ALTER TABLE activity_log ADD COLUMN unit_id TEXT;
ALTER TABLE activity_log ADD COLUMN tenant_id TEXT;
ALTER TABLE activity_log ADD COLUMN target_name TEXT;
ALTER TABLE activity_log ADD COLUMN previous_values TEXT;  -- JSON { field: value }
ALTER TABLE activity_log ADD COLUMN new_values TEXT;        -- JSON { field: value }

CREATE INDEX IF NOT EXISTS idx_activity_log_module ON activity_log(module);
CREATE INDEX IF NOT EXISTS idx_activity_log_property ON activity_log(property_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_tenant ON activity_log(tenant_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_target ON activity_log(target_type, target_id);
