-- Email campaigns (draft storage) for the Email Campaign system (Phase 2).
-- Composing, segmenting, and test-sending happen here; bulk sending and
-- per-recipient delivery logging come in Phase 3.
CREATE TABLE IF NOT EXISTS email_campaigns (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  category         TEXT NOT NULL DEFAULT 'custom',
  subject          TEXT NOT NULL DEFAULT '',
  preview_text     TEXT,
  body_html        TEXT NOT NULL DEFAULT '',
  template_id      TEXT,
  recipient_filter TEXT,                       -- JSON RecipientFilter
  status           TEXT NOT NULL DEFAULT 'draft', -- draft|scheduled|processing|sent|partially_delivered|failed|paused|canceled
  scheduled_at     TEXT,
  recipient_count  INTEGER NOT NULL DEFAULT 0,
  created_by       TEXT,
  created_at       INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at       INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_email_campaigns_status ON email_campaigns(status, created_at);
