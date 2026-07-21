-- Handymen can keep their own contact details up to date from their portal.
-- Phone already exists on the roster row; add a mailing address. Their profile
-- photo reuses user.image, like realtors, so no column is needed for it here.
ALTER TABLE handymen ADD COLUMN address TEXT;
ALTER TABLE handymen ADD COLUMN city TEXT;
ALTER TABLE handymen ADD COLUMN state TEXT;
ALTER TABLE handymen ADD COLUMN zip_code TEXT;
