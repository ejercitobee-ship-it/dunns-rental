-- Per-recipient delivery log + send counters for email campaigns (Phase 3).
CREATE TABLE IF NOT EXISTS campaign_recipients (
  id          TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  tenant_id   TEXT,
  email       TEXT NOT NULL,
  name        TEXT,
  status      TEXT NOT NULL DEFAULT 'queued',  -- queued|sent|failed|skipped
  error       TEXT,
  sent_at     INTEGER,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_campaign_recipients ON campaign_recipients(campaign_id, status);

ALTER TABLE email_campaigns ADD COLUMN sent_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE email_campaigns ADD COLUMN failed_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE email_campaigns ADD COLUMN sent_at INTEGER;
