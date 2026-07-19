-- Drive file id of the tenant's profile photo, in Belle's Profile Photos Drive
-- folder. NULL means no photo (show initials).
ALTER TABLE tenants ADD COLUMN photo_drive_id TEXT;
