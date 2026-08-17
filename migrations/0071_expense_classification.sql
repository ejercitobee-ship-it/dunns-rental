-- Explicit expense type: user chooses operating vs capital (no more auto-classify by amount).
-- NULL = legacy row (backward compatible; isCapitalExpense() falls back to old logic).
ALTER TABLE expenses ADD COLUMN expense_type TEXT;  -- 'operating' | 'capital'

-- Classification review status. 'confirmed' = user made a deliberate choice.
-- 'needs_review' = system flagged for admin review (e.g. ambiguous import).
-- NULL = legacy row, treated as confirmed.
ALTER TABLE expenses ADD COLUMN classification_status TEXT;  -- 'confirmed' | 'needs_review'
