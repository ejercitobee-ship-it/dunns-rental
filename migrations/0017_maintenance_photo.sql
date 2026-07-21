-- Tenants can attach a photo to a maintenance request. The image lives in Drive
-- (a "Maintenance Photos" folder); this column holds its Drive file id, served
-- through /api/photo/:id like the profile photos.
ALTER TABLE maintenance_requests ADD COLUMN photo_drive_id TEXT;
