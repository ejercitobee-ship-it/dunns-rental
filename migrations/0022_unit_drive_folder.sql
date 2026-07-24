-- Documents are now organized by UNIT, so housemates on the same lease share one
-- Drive folder. This holds each unit's folder id (created on first use).
ALTER TABLE units ADD COLUMN drive_folder_id TEXT;
