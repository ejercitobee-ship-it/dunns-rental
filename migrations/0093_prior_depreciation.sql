-- Prior depreciation: amount already claimed on tax returns before using this app.
-- Subtracted from the depreciable basis so the app only computes what remains.
ALTER TABLE properties ADD COLUMN prior_depreciation REAL;
ALTER TABLE capital_projects ADD COLUMN prior_depreciation REAL;
