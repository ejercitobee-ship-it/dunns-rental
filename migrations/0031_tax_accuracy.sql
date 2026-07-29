-- Tax accuracy: depreciation inputs + mortgage interest split.
-- land_value: the non-depreciable land portion of a property's cost basis.
--   Only the building depreciates (residential, 27.5-year straight line), so we
--   subtract land from purchase_price to get the depreciable basis.
-- interest_amount: the deductible interest portion of a mortgage expense.
--   A mortgage payment is principal (not deductible) + interest (deductible);
--   this stores the interest so the tax report never deducts principal.
ALTER TABLE properties ADD COLUMN land_value REAL;
ALTER TABLE expenses ADD COLUMN interest_amount REAL;
