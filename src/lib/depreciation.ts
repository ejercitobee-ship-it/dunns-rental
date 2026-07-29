// Residential rental depreciation: straight-line over 27.5 years with the IRS
// mid-month convention. Only the building depreciates, not the land, so the
// depreciable basis is the purchase price minus the land value. When the land
// value has not been entered we assume a default ratio of the price (clearly
// flagged as an estimate in the UI, to be confirmed with an accountant).

export const RESIDENTIAL_RECOVERY_YEARS = 27.5;
export const DEFAULT_LAND_RATIO = 0.2;

export interface DepreciationInput {
  purchasePrice?: number;
  purchaseDate?: string; // YYYY-MM-DD (used as the placed-in-service date)
  landValue?: number;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** The non-depreciable land portion: explicit if entered, else a default ratio. */
export function landValueFor(input: DepreciationInput): number {
  if (input.landValue != null && input.landValue >= 0) return round2(input.landValue);
  if (input.purchasePrice && input.purchasePrice > 0) return round2(input.purchasePrice * DEFAULT_LAND_RATIO);
  return 0;
}

/** The depreciable (building-only) basis. Zero when we lack a purchase price. */
export function depreciableBasis(input: DepreciationInput): number {
  if (!input.purchasePrice || input.purchasePrice <= 0) return 0;
  const basis = input.purchasePrice - landValueFor(input);
  return basis > 0 ? round2(basis) : 0;
}

/** Whether we have everything needed to compute depreciation for this property. */
export function canDepreciate(input: DepreciationInput): boolean {
  return depreciableBasis(input) > 0 && parsePlacedInService(input.purchaseDate) !== null;
}

function parsePlacedInService(date?: string): { year: number; month: number } | null {
  if (!date) return null;
  const [y, m] = date.split('-').map(Number);
  if (!y || !m || m < 1 || m > 12) return null;
  return { year: y, month: m };
}

/**
 * Cumulative depreciation taken through the END of `taxYear`, capped at the
 * basis. Mid-month convention: the placed-in-service month counts as half a
 * month, so the first year is prorated by (12 - month + 0.5) / 12.
 */
export function accumulatedDepreciation(input: DepreciationInput, taxYear: number): number {
  const basis = depreciableBasis(input);
  const pis = parsePlacedInService(input.purchaseDate);
  if (basis === 0 || !pis || taxYear < pis.year) return 0;

  const annual = basis / RESIDENTIAL_RECOVERY_YEARS;
  let acc = 0;
  for (let y = pis.year; y <= taxYear; y++) {
    const fraction = y === pis.year ? (12 - pis.month + 0.5) / 12 : 1;
    acc += annual * fraction;
    if (acc >= basis) return basis;
  }
  return round2(acc);
}

/** The depreciation deductible in a single tax year (the current-year figure). */
export function depreciationForYear(input: DepreciationInput, taxYear: number): number {
  const prior = accumulatedDepreciation(input, taxYear - 1);
  const current = accumulatedDepreciation(input, taxYear);
  return round2(current - prior);
}
