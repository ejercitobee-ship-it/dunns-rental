// MACRS depreciation for rental real estate following federal (IRS) and
// Illinois state tax law. Illinois conforms to federal MACRS depreciation
// and does NOT allow bonus depreciation (requires add-back on IL-1040).
//
// Recovery periods and conventions:
//   27.5 yr — residential rental property (mid-month convention)
//   15 yr  — land improvements: parking lots, fencing, landscaping (half-year)
//    7 yr  — furniture, fixtures, office equipment (half-year)
//    5 yr  — appliances, carpeting, certain personal property (half-year)
//
// All classes use straight-line (GDS) which is the standard for rental property.

export const RESIDENTIAL_RECOVERY_YEARS = 27.5;
export const DEFAULT_LAND_RATIO = 0.2;

export type RecoveryPeriod = 5 | 7 | 15 | 27.5;

export const RECOVERY_PERIOD_OPTIONS: { value: RecoveryPeriod; label: string; description: string }[] = [
  { value: 5,    label: '5 year',    description: 'Appliances, carpeting, certain personal property' },
  { value: 7,    label: '7 year',    description: 'Furniture, fixtures, office equipment' },
  { value: 15,   label: '15 year',   description: 'Land improvements: parking, fencing, landscaping' },
  { value: 27.5, label: '27.5 year', description: 'Residential structure improvements' },
];

export interface DepreciationInput {
  purchasePrice?: number;
  purchaseDate?: string; // YYYY-MM-DD (used as the placed-in-service date)
  landValue?: number;
}

export interface CapitalDepreciationInput {
  totalCost: number;
  placedInServiceDate?: string; // YYYY-MM-DD
  recoveryYears?: number;       // 5, 7, 15, or 27.5
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

// ---------------------------------------------------------------------------
// Capital project depreciation (MACRS)
// ---------------------------------------------------------------------------

/** Whether a capital project has the data needed to compute depreciation. */
export function canDepreciateProject(input: CapitalDepreciationInput): boolean {
  return (
    input.totalCost > 0 &&
    input.recoveryYears != null &&
    input.recoveryYears > 0 &&
    parsePlacedInService(input.placedInServiceDate) !== null
  );
}

/**
 * Cumulative depreciation for a capital project through the END of `taxYear`.
 *
 * 27.5 yr real property uses the mid-month convention (same as buildings):
 *   first year = annual * (12 - month + 0.5) / 12
 *
 * 5, 7, 15 yr personal property / land improvements use the half-year convention:
 *   first year  = annual * 0.5
 *   last year   = annual * 0.5  (whatever remains, capped at basis)
 *   middle years = full annual amount
 */
export function accumulatedProjectDepreciation(
  input: CapitalDepreciationInput,
  taxYear: number,
): number {
  if (!canDepreciateProject(input)) return 0;
  const basis = input.totalCost;
  const recoveryYears = input.recoveryYears!;
  const pis = parsePlacedInService(input.placedInServiceDate)!;
  if (taxYear < pis.year) return 0;

  const annual = basis / recoveryYears;
  const useMidMonth = recoveryYears === 27.5;
  let acc = 0;

  for (let y = pis.year; y <= taxYear; y++) {
    let fraction: number;
    if (y === pis.year) {
      fraction = useMidMonth
        ? (12 - pis.month + 0.5) / 12
        : 0.5;
    } else {
      fraction = 1;
    }
    acc += annual * fraction;
    if (acc >= basis) return basis;
  }
  return round2(acc);
}

/** The depreciation deduction for a capital project in a single tax year. */
export function projectDepreciationForYear(
  input: CapitalDepreciationInput,
  taxYear: number,
): number {
  const prior = accumulatedProjectDepreciation(input, taxYear - 1);
  const current = accumulatedProjectDepreciation(input, taxYear);
  return round2(current - prior);
}
