-- A receipt image for an expense (a screenshot the office uploads). The file is
-- stored in the unit's Google Drive folder; this holds the Drive file id.
ALTER TABLE expenses ADD COLUMN receipt_drive_id TEXT;
