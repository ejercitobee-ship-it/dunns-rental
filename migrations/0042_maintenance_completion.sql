-- Handyman completion photo and auto-generated work report PDF
ALTER TABLE maintenance_requests ADD COLUMN completion_photo_drive_id TEXT;
ALTER TABLE maintenance_requests ADD COLUMN work_report_drive_id TEXT;
