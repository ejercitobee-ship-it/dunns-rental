/**
 * Jurisdiction-aware late fee calculation.
 *
 * Priority: a custom amount set on the property always wins.
 * When no custom amount is set, the jurisdiction formula applies:
 *   Chicago RLTO (5-12-140): $10 + 5% of rent above $500, 5-day grace min.
 *   Cook County RTLO: $10 + 5% of rent above $1,000, 5-day grace min.
 *   No jurisdiction / no cap: returns 0 (nothing to charge).
 */

export interface LateFeeInput {
  monthlyRent: number;
  jurisdiction: string | null;
  configuredAmount: number | null;
  feeType: string;
}

function jurisdictionMax(jurisdiction: string, rent: number): number {
  if (jurisdiction === 'chicago_rlto') {
    return Math.round((10 + Math.max(0, rent - 500) * 0.05) * 100) / 100;
  }
  if (jurisdiction === 'cook_county_rtlo') {
    return Math.round((10 + Math.max(0, rent - 1000) * 0.05) * 100) / 100;
  }
  return 0;
}

export function calculateLateFee(input: LateFeeInput): number {
  const j = (input.jurisdiction || '').toLowerCase().trim();

  // Custom amount on the property always takes priority.
  if (input.configuredAmount && input.configuredAmount > 0) {
    if (input.feeType === 'percent') {
      return Math.round(input.monthlyRent * (input.configuredAmount / 100) * 100) / 100;
    }
    return input.configuredAmount;
  }

  // No custom amount: fall back to the jurisdiction formula.
  return jurisdictionMax(j, input.monthlyRent);
}

/** The legal cap for the jurisdiction (0 if none). */
export function jurisdictionCap(jurisdiction: string | null, rent: number): number {
  const j = (jurisdiction || '').toLowerCase().trim();
  return jurisdictionMax(j, rent);
}

/** Human-readable fee description for notifications. */
export function lateFeeDescription(input: LateFeeInput): string {
  const amount = calculateLateFee(input);
  if (amount <= 0) return '';

  const j = (input.jurisdiction || '').toLowerCase().trim();
  const hasCustom = input.configuredAmount && input.configuredAmount > 0;

  if (hasCustom) {
    if (input.feeType === 'percent' && input.configuredAmount) {
      return `$${amount.toFixed(2)} (${input.configuredAmount}% of rent)`;
    }
    return `$${amount.toFixed(2)}`;
  }

  if (j === 'chicago_rlto') {
    return `$${amount.toFixed(2)} (per Chicago RLTO)`;
  }
  if (j === 'cook_county_rtlo') {
    return `$${amount.toFixed(2)} (per Cook County RTLO)`;
  }
  return `$${amount.toFixed(2)}`;
}
