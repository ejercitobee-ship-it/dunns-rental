-- Capital project depreciation: add MACRS recovery period and placed-in-service
-- date so capital improvements can be depreciated alongside properties.
ALTER TABLE capital_projects ADD COLUMN recovery_years REAL;
ALTER TABLE capital_projects ADD COLUMN placed_in_service_date TEXT;
