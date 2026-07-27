-- Every lease should carry a yearly expiration so the tenant portal can warn a
-- month before it lapses. Backfill any active/paused lease that has a start date
-- but no end date, setting the end date to one year after the start. Ended leases
-- and drafts with no start date are left alone.
UPDATE leases
SET end_date = date(start_date, '+1 year'),
    updated_at = unixepoch()
WHERE end_date IS NULL
  AND start_date IS NOT NULL
  AND status != 'ended';
