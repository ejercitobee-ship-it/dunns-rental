-- Backdated leases still show an expiration in the past (e.g. a 2019 lease
-- ending Apr 1, 2020). Move every non-ended lease whose end date is before 2025
-- up to the same month and day in 2026, so current contracts read as active.
-- Leases that already expire in 2025 (or later) are left exactly as they are.
UPDATE leases
SET end_date = '2026-' || substr(end_date, 6, 5),
    updated_at = unixepoch()
WHERE end_date IS NOT NULL
  AND status != 'ended'
  AND CAST(substr(end_date, 1, 4) AS INTEGER) < 2025;
