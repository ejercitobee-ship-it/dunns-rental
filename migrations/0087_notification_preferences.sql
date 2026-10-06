-- Per-user notification preferences: users can mute specific categories.
-- Only muted categories are stored; absence = enabled (opt-out model).
CREATE TABLE IF NOT EXISTS mgmt_notification_preferences (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(user_id, category)
);
CREATE INDEX IF NOT EXISTS idx_notif_pref_user ON mgmt_notification_preferences(user_id);
